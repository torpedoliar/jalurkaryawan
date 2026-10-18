import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { addDays, departureAt, isoWeekday, jakartaDate } from '@bms/shared';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Trip generation (spec §5.2): one logical unit per date, ON CONFLICT (templateId,date)
 * DO NOTHING via createMany skipDuplicates — idempotent catch-up safe.
 */
@Injectable()
export class GenerateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Generate trips for one operational date. Returns count created. */
  async generateTrips(date: string): Promise<number> {
    const templates = await this.prisma.tripTemplate.findMany({
      where: { active: true },
      include: { bus: true },
    });
    const weekday = isoWeekday(date);
    const rows = templates
      .filter((t) => t.weekdays.includes(weekday))
      .map((t) => ({
        templateId: t.id,
        date,
        departureAt: departureAt(date, t.departureTime, t.dayOffset as 0 | 1),
        status: 'SCHEDULED' as const,
        bookedCount: 0,
        capacity: t.bus.capacity,
        routeId: t.routeId,
        shiftId: t.shiftId,
        direction: t.direction,
        busId: t.busId,
      }));
    if (!rows.length) return 0;
    const r = await this.prisma.trip.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  }

  /** Generate today..today+generate_days_ahead (settings-driven). Returns total created. */
  async fillWindow(): Promise<number> {
    const today = jakartaDate(new Date());
    const ahead = this.settings.get().generate_days_ahead;
    let total = 0;
    for (let i = 0; i <= ahead; i++) {
      total += await this.generateTrips(addDays(today, i));
    }
    return total;
  }
}
