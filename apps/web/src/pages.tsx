import type { ReactNode } from "react";
import { ADMIN_ROLES, Role } from "@bms/shared";
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
import { VendorsBuses } from "./pages/admin/VendorsBuses";
import { VendorHome } from "./pages/vendor/VendorHome";

export interface Page { path: string; label: string; roles: readonly Role[]; element: ReactNode }

const ALL = Role.options;
const EMP: readonly Role[] = ["EMPLOYEE"];
const ADM = ADMIN_ROLES;
const SUPER: readonly Role[] = ["SUPER_ADMIN"];
const VEN: readonly Role[] = ["VENDOR"];

/** Nav + routes. A role's first visible page is its landing page. */
export const PAGES: Page[] = [
  { path: "/beranda", label: "Beranda", roles: EMP, element: <Home /> },
  { path: "/booking", label: "Booking Harian", roles: EMP, element: <Book /> },
  { path: "/langganan", label: "Langganan", roles: EMP, element: <Subscriptions /> },
  { path: "/riwayat", label: "Riwayat", roles: EMP, element: <History /> },
  { path: "/notifikasi", label: "Notifikasi", roles: EMP, element: <Notifications /> },
  { path: "/vendor-bus", label: "Vendor & Bus", roles: ADM, element: <VendorsBuses /> },
  { path: "/rute", label: "Rute & Titik", roles: ADM, element: <RoutesStops /> },
  { path: "/shift-jadwal", label: "Shift & Jadwal", roles: ADM, element: <ShiftsTemplates /> },
  { path: "/trip", label: "Trip Harian", roles: ADM, element: <Trips /> },
  { path: "/karyawan", label: "Karyawan", roles: ADM, element: <Employees /> },
  { path: "/admin-user", label: "Admin & Vendor", roles: SUPER, element: <Admins /> },
  { path: "/dashboard", label: "Dashboard", roles: ADM, element: <Dashboard /> },
  { path: "/laporan", label: "Laporan", roles: ADM, element: <Reports /> },
  { path: "/audit", label: "Audit Log", roles: ADM, element: <Audit /> },
  { path: "/pengaturan", label: "Pengaturan", roles: SUPER, element: <SettingsScreen /> },
  { path: "/vendor", label: "Dashboard Vendor", roles: VEN, element: <VendorHome /> },
  { path: "/keberangkatan", label: "Papan Keberangkatan", roles: ALL, element: <Departures /> },
  { path: "/ganti-password", label: "Ganti Password", roles: ALL, element: <ChangePassword /> },
];
