import type { ReactNode } from "react";
import { ADMIN_ROLES, SELF_SERVICE_ROLES, Role } from "@bms/shared";
import { ChangePassword } from "./pages/ChangePassword";
import { Departures } from "./pages/Departures";
import { Book } from "./pages/employee/Book";
import { History } from "./pages/employee/History";
import { Home } from "./pages/employee/Home";
import { Notifications } from "./pages/employee/Notifications";
import { Subscriptions } from "./pages/employee/Subscriptions";
import { Admins } from "./pages/admin/Admins";
import { Audit } from "./pages/admin/Audit";
import { Dashboard } from "./pages/admin/Dashboard";
import { Employees } from "./pages/admin/Employees";
import { Reports } from "./pages/admin/Reports";
import { RoutesStops } from "./pages/admin/Routes";
import { SettingsScreen } from "./pages/admin/SettingsScreen";
import { ShiftsTemplates } from "./pages/admin/ShiftsTemplates";
import { Trips } from "./pages/admin/Trips";
import { Tracking } from "./pages/admin/Tracking";
import { VendorsBuses } from "./pages/admin/VendorsBuses";
import { VendorHome } from "./pages/vendor/VendorHome";

/** Sidebar sections, in display order. A section shows only when the role sees at least one of its pages. */
export const GROUPS = ["Perjalanan Saya", "Pantauan", "Operasional", "Data Master", "Pengguna", "Laporan & Audit", "Sistem", "Akun"] as const;
export type Group = (typeof GROUPS)[number];

export interface Page { path: string; label: string; group: Group; roles: readonly Role[]; element: ReactNode }

const ALL = Role.options;
const EMP: readonly Role[] = ["EMPLOYEE"];
const SELF = SELF_SERVICE_ROLES;
const ADM = ADMIN_ROLES;
const SUPER: readonly Role[] = ["SUPER_ADMIN"];
const VEN: readonly Role[] = ["VENDOR"];

/** Explicit home per role. Order alone cannot satisfy both the admin Dashboard and employee Beranda landing. */
export const LANDING: Partial<Record<Role, string>> = {
  SUPER_ADMIN: "/dashboard", ADMIN_GA: "/dashboard", VENDOR: "/vendor", EMPLOYEE: "/beranda", DRIVER: "/keberangkatan",
};

/**
 * Nav + routes. A role's first visible page is its landing page; within a group, array order is nav order.
 * Admin pages come first so admins land on Dashboard, while employee pages still become Beranda for employees.
 */
export const PAGES: Page[] = [
  { path: "/dashboard", label: "Dashboard", group: "Pantauan", roles: ADM, element: <Dashboard /> },
  { path: "/vendor", label: "Dashboard Vendor", group: "Pantauan", roles: VEN, element: <VendorHome /> },
  { path: "/keberangkatan", label: "Papan Keberangkatan", group: "Pantauan", roles: ALL, element: <Departures /> },
  { path: "/notifikasi", label: "Notifikasi", group: "Pantauan", roles: SELF, element: <Notifications /> },
  { path: "/trip", label: "Trip Harian", group: "Operasional", roles: ADM, element: <Trips /> },
  { path: "/tracking", label: "Tracking Bus", group: "Operasional", roles: ADM, element: <Tracking /> },
  { path: "/vendor-bus", label: "Vendor & Bus", group: "Data Master", roles: ADM, element: <VendorsBuses /> },
  { path: "/rute", label: "Rute & Titik", group: "Data Master", roles: ADM, element: <RoutesStops /> },
  { path: "/shift-jadwal", label: "Shift & Jadwal", group: "Data Master", roles: ADM, element: <ShiftsTemplates /> },
  { path: "/karyawan", label: "Karyawan", group: "Pengguna", roles: ADM, element: <Employees /> },
  /** Spec 6.1: vendor accounts are ADMIN_GA work; only admin accounts are Super-Admin-only. */
  { path: "/admin-user", label: "Admin & Vendor", group: "Pengguna", roles: ADM, element: <Admins /> },
  { path: "/laporan", label: "Laporan", group: "Laporan & Audit", roles: ADM, element: <Reports /> },
  { path: "/audit", label: "Audit Log", group: "Laporan & Audit", roles: ADM, element: <Audit /> },
  { path: "/pengaturan", label: "Pengaturan", group: "Sistem", roles: SUPER, element: <SettingsScreen /> },
  { path: "/beranda", label: "Beranda", group: "Perjalanan Saya", roles: SELF, element: <Home /> },
  { path: "/booking", label: "Booking Harian", group: "Perjalanan Saya", roles: SELF, element: <Book /> },
  { path: "/langganan", label: "Langganan", group: "Perjalanan Saya", roles: SELF, element: <Subscriptions /> },
  { path: "/riwayat", label: "Riwayat", group: "Perjalanan Saya", roles: SELF, element: <History /> },
  { path: "/ganti-password", label: "Ganti Password", group: "Akun", roles: ALL, element: <ChangePassword /> },
];
