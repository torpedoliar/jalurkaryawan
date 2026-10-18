import { PrismaClient } from '@prisma/client';

/**
 * spec §5.6 helper: a route/shift/bus is "in use" when an active TripTemplate references it
 * OR a SCHEDULED not-yet-departed Trip does. Used to block deactivate / hard-delete.
 */
export async function inUseByTrips(
  prisma: PrismaClient,
  filter: { routeId?: string; shiftId?: string; busId?: string },
): Promise<boolean> {
  const match = {
    ...(filter.routeId ? { routeId: filter.routeId } : {}),
    ...(filter.shiftId ? { shiftId: filter.shiftId } : {}),
    ...(filter.busId ? { busId: filter.busId } : {}),
  };
  const template = await prisma.tripTemplate.findFirst({ where: { active: true, ...match } });
  if (template) return true;
  const trip = await prisma.trip.findFirst({
    where: { status: 'SCHEDULED', departureAt: { gt: new Date() }, ...match },
  });
  return !!trip;
}
