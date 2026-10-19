import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, isPastCutoff, jakartaDate } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';

export interface AllocateParams {
  userId: string;
  routeId: string;
  stopId: string;
  shiftId: string;
  direction: 'PICKUP' | 'DROPOFF';
  date: string; // YYYY-MM-DD
  source: 'DAILY' | 'SUBSCRIPTION';
  subscriptionId?: string;
  fromCron?: boolean;
  /** Run the claim inside this transaction (spec §5.2 one-tx-per-date) instead of opening its own. */
  tx?: Prisma.TransactionClient;
}

/**
 * spec §5.1 allocation core. One transaction; conditional UPDATE for atomic seat claim;
 * rejected row inserted OUTSIDE the tx on TRIP_FULL (committed independently);
 * no SELECT FOR UPDATE; unique partial index is the backstop for races.
 */
@Injectable()
export class AllocateService {
  constructor(private readonly prisma: PrismaClient, private readonly settings: SettingsService) {}

  async allocateSeat(params: AllocateParams): Promise<{ bookingId: string }> {
    let fullError: DomainError | null = null;
    const run = async (tx: Prisma.TransactionClient): Promise<{ bookingId: string }> => {
          const user = await tx.user.findUnique({ where: { id: params.userId } });
          if (!user?.active) throw new DomainError('FORBIDDEN', ERROR_MESSAGES.FORBIDDEN);

          if (!params.fromCron && user.bookingSuspendedUntil) {
            // DAILY uses today, SUB uses the booking date (allocate.ts parity)
            const refDate = params.source === 'DAILY' ? jakartaDate(new Date()) : params.date;
            const refMs = new Date(`${refDate}T00:00:00+07:00`).getTime();
            if (user.bookingSuspendedUntil.getTime() >= refMs) {
              throw new DomainError('USER_SUSPENDED', ERROR_MESSAGES.USER_SUSPENDED);
            }
          }

          const stop = await tx.stop.findFirst({ where: { id: params.stopId, routeId: params.routeId, active: true } });
          if (!stop) throw new DomainError('VALIDATION_ERROR', 'Titik jemput tidak valid untuk rute ini.');

          const conflict = await tx.booking.findFirst({
            where: { userId: params.userId, date: params.date, shiftId: params.shiftId, direction: params.direction, status: 'BOOKED' },
          });
          if (conflict) throw new DomainError('SCHEDULE_CONFLICT', ERROR_MESSAGES.SCHEDULE_CONFLICT);

          const trips = await tx.trip.findMany({
            where: { routeId: params.routeId, shiftId: params.shiftId, direction: params.direction, date: params.date, status: 'SCHEDULED' },
            orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
          });
          if (!trips.length) throw new DomainError('NOT_FOUND', 'Belum ada trip untuk pilihan ini.');

          const cutoffMin = this.settings.get().booking_cutoff_minutes;
          const now = new Date();
          const open = params.fromCron ? trips : trips.filter((t) => !isPastCutoff(t.departureAt.toISOString(), cutoffMin, now));
          if (!open.length) throw new DomainError('CUTOFF_PASSED', ERROR_MESSAGES.CUTOFF_PASSED);

          for (const trip of open) {
            // atomic conditional claim: no FOR UPDATE, no over-booking under concurrency
            const claimed = await tx.$executeRaw`
              UPDATE "Trip" SET "bookedCount" = "bookedCount" + 1
              WHERE id = ${trip.id} AND status = 'SCHEDULED' AND "bookedCount" < capacity`;
            if (claimed === 1) {
              try {
                const booking = await tx.booking.create({
                  data: {
                    userId: params.userId, tripId: trip.id, routeId: params.routeId, stopId: params.stopId,
                    shiftId: params.shiftId, direction: params.direction, date: params.date,
                    source: params.source, subscriptionId: params.subscriptionId ?? null,
                  },
                });
                return { bookingId: booking.id };
              } catch (e) {
                // partial unique violation = race lost between pre-check and insert → SCHEDULE_CONFLICT
                const code = (e as { code?: string }).code;
                if (code === 'P2002') throw new DomainError('SCHEDULE_CONFLICT', ERROR_MESSAGES.SCHEDULE_CONFLICT);
                throw e;
              }
            }
          }
          // no trip had space → mark for outside-tx rejected insert, then throw
          fullError = new DomainError('TRIP_FULL', ERROR_MESSAGES.TRIP_FULL);
          throw fullError;
    };
    try {
      // caller-supplied tx = participate in its one-tx-per-date (§5.2); else open own tx (§5.1)
      if (params.tx) return await run(params.tx);
      // ponytail: generous waits — 100 concurrent claimants serialize on the Trip row lock
      return await this.prisma.$transaction(run, { maxWait: 10_000, timeout: 30_000 });
    } catch (e) {
      if (e === fullError) {
        // commit the rejected row independently (spec §5.1: outside the tx)
        await this.prisma.rejectedRequest.create({
          data: {
            userId: params.userId, routeId: params.routeId, stopId: params.stopId,
            shiftId: params.shiftId, direction: params.direction, date: params.date,
            reason: 'TRIP_FULL', source: params.source, subscriptionId: params.subscriptionId ?? null,
          },
        });
      }
      throw e;
    }
  }
}
