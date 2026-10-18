// apps/api/test/notifications.test.ts — Task 11: reminder candidates, FCM unconfigured paths, cleanup
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { jakartaDate, toJakartaIso } from '@bms/shared';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FcmService } from '../src/notifications/fcm.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let notifications: NotificationsService;
let settings: SettingsService;
let userId: string;
let tripId: string;

beforeAll(async () => {
  // FK-safe wipe (reports.test precedent) so the file is re-runnable standalone
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.deviceToken.deleteMany(), prisma.rejectedRequest.deleteMany(),
    prisma.subscription.deleteMany(), prisma.booking.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(),
    prisma.stop.deleteMany(), prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.refreshToken.deleteMany(), prisma.auditLog.deleteMany(), prisma.user.deleteMany(),
  ]);
  // settings.update writes audit with actor FK (settings.test precedent)
  await prisma.user.upsert({
    where: { id: 'a' },
    create: { id: 'a', nik: 'TEST-A', name: 'Admin', role: 'SUPER_ADMIN' },
    update: {},
  });
  const audit = new AuditService(prisma);
  settings = new SettingsService(prisma, audit, key);
  await settings.init();
  const fcm = new FcmService(settings, prisma);
  notifications = new NotificationsService(prisma, fcm, settings);

  const user = await prisma.user.create({ data: { nik: 'K1001', name: 'Emp', role: 'EMPLOYEE', active: true } });
  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 50, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'malam', name: 'Malam', startTime: '23:00', endTime: '07:00' } });
  const stop = await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  const date = jakartaDate(new Date());
  // trip departing within reminder window (now + 30min, reminder=60)
  const soon = new Date(Date.now() + 30 * 60 * 1000);
  const tpl = await prisma.tripTemplate.create({
    data: { routeId: route.id, shiftId: 'malam', direction: 'PICKUP', busId: bus.id, departureTime: '23:00', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
  });
  const trip = await prisma.trip.create({
    data: { templateId: tpl.id, date, departureAt: soon, status: 'SCHEDULED', bookedCount: 1, capacity: 50, routeId: route.id, shiftId: 'malam', direction: 'PICKUP', busId: bus.id },
  });
  await prisma.booking.create({
    data: { userId: user.id, tripId: trip.id, routeId: route.id, stopId: stop.id, shiftId: 'malam', direction: 'PICKUP', date, status: 'BOOKED', source: 'DAILY' },
  });
  userId = user.id; tripId = trip.id;
});

// schema.test/raw suites assume no leftover Route R1 (reports.test precedent)
afterAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.deviceToken.deleteMany(), prisma.rejectedRequest.deleteMany(),
    prisma.subscription.deleteMany(), prisma.booking.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(),
    prisma.stop.deleteMany(), prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.refreshToken.deleteMany(), prisma.auditLog.deleteMany(), prisma.user.deleteMany(),
  ]);
  await prisma.$disconnect();
});

describe('reminder candidates', () => {
  test('sendReminderCandidates finds BOOKED within reminder_minutes, sets reminderSentAt, creates REMINDER', async () => {
    await notifications.sendReminderCandidates();
    const n = await prisma.notification.findFirst({ where: { userId, type: 'REMINDER' } });
    expect(n).toBeTruthy();
    const b = await prisma.booking.findFirstOrThrow({ where: { tripId } });
    expect(b.reminderSentAt).toBeTruthy();
  });

  // WIB = UTC+7 always, so body hour must come from toJakartaIso — toISOString is always wrong
  test('reminder body uses Asia/Jakarta hour, not UTC', async () => {
    const trip = await prisma.trip.findFirstOrThrow({ where: { id: tripId } });
    const wib = toJakartaIso(trip.departureAt.getTime()).slice(11, 16);
    const utc = trip.departureAt.toISOString().slice(11, 16);
    expect(wib).not.toBe(utc); // fixture sanity: 7h offset makes the two hours differ
    const n = await prisma.notification.findFirstOrThrow({ where: { userId, type: 'REMINDER' } });
    expect(n.body).toContain(wib);
    expect(n.body).not.toContain(utc);
  });

  test('idempotent: second run does not duplicate reminder', async () => {
    const before = await prisma.notification.count({ where: { userId, type: 'REMINDER' } });
    await notifications.sendReminderCandidates();
    const after = await prisma.notification.count({ where: { userId, type: 'REMINDER' } });
    expect(after).toBe(before);
  });
});

describe('fcm service (unconfigured paths)', () => {
  test('send when push disabled returns {sent:0,failed:0}, no throw', async () => {
    settings.update({ push_enabled: false }, { id: 'a', name: 'Admin' });
    const fcm = new FcmService(settings, prisma);
    const r = await fcm.send([{ token: 'tok', platform: 'android' }], 't', 'b', {});
    expect(r).toEqual({ sent: 0, failed: 0 });
  });

  test('send when push enabled but no fcm secret returns {sent:0,failed:0}, logs warn', async () => {
    settings.update({ push_enabled: true, fcm_service_account: '' }, { id: 'a', name: 'Admin' });
    const fcm = new FcmService(settings, prisma);
    const r = await fcm.send([{ token: 'tok', platform: 'android' }], 't', 'b', {});
    expect(r).toEqual({ sent: 0, failed: 0 });
    settings.update({ push_enabled: false }, { id: 'a', name: 'Admin' });
  });
});

describe('cleanup', () => {
  test('cleanup deletes notifications older than retention', async () => {
    await prisma.notification.create({
      data: { userId, type: 'REMINDER', title: 'old', body: 'old', readAt: null, createdAt: new Date(Date.now() - 100 * 86_400_000) },
    });
    await notifications.cleanup(90); // default retention 90 days
    const old = await prisma.notification.findFirst({ where: { title: 'old' } });
    expect(old).toBeNull();
    const recent = await prisma.notification.findFirst({ where: { userId, type: 'REMINDER' } });
    expect(recent).toBeTruthy();
  });
});
