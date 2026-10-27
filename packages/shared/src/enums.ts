import { z } from "zod";

export const Role = z.enum(["SUPER_ADMIN", "ADMIN_GA", "EMPLOYEE", "VENDOR", "DRIVER"]);
export type Role = z.infer<typeof Role>;
export const Direction = z.enum(["PICKUP", "DROPOFF"]);
export type Direction = z.infer<typeof Direction>;
export const TripStatus = z.enum(["SCHEDULED", "CANCELLED"]);
export type TripStatus = z.infer<typeof TripStatus>;
export const BookingStatus = z.enum(["BOOKED", "CANCELLED", "NO_SHOW"]);
export type BookingStatus = z.infer<typeof BookingStatus>;
export const BookingSource = z.enum(["SUBSCRIPTION", "DAILY"]);
export type BookingSource = z.infer<typeof BookingSource>;
export const SubscriptionStatus = z.enum(["ACTIVE", "ENDED"]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;
export const CancelReason = z.enum(["USER", "ADMIN_TRIP", "SUSPENDED", "SUBSCRIPTION_ENDED", "USER_DEACTIVATED"]);
export type CancelReason = z.infer<typeof CancelReason>;
/** Spec 5.7 notification kinds. */
export const NotificationType = z.enum([
  "TRIP_CANCELLED", "BUS_CHANGED", "SCHEDULE_CHANGED", "BOOKING_CANCELLED", "SUBSCRIPTION_REJECTED", "SUSPENDED", "UNSUSPENDED", "REMINDER",
]);
export type NotificationType = z.infer<typeof NotificationType>;
export const AuthProvider = z.enum(["LOCAL", "SSO"]);
export type AuthProvider = z.infer<typeof AuthProvider>;
/** Departure board status. ALMOST = booked >= 90% of capacity. UI labels: TERSEDIA/HAMPIR/PENUH/BATAL. */
export const DepartureStatus = z.enum(["AVAILABLE", "ALMOST", "FULL", "CANCELLED"]);
export type DepartureStatus = z.infer<typeof DepartureStatus>;

export const ADMIN_ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN_GA"];
/** Roles that can use employee self-service: own bookings, subscriptions, history, notifications, ticket QR and self check-in. */
export const SELF_SERVICE_ROLES: readonly Role[] = ["EMPLOYEE", "SUPER_ADMIN", "ADMIN_GA"];
