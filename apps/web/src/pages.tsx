import type { ReactNode } from "react";
import { Role } from "@bms/shared";
import { ChangePassword } from "./pages/ChangePassword";
import { Departures } from "./pages/Departures";
import { Book } from "./pages/employee/Book";
import { History } from "./pages/employee/History";
import { Home } from "./pages/employee/Home";
import { Notifications } from "./pages/employee/Notifications";
import { Subscriptions } from "./pages/employee/Subscriptions";

export interface Page { path: string; label: string; roles: readonly Role[]; element: ReactNode }

const ALL = Role.options;
const EMP: readonly Role[] = ["EMPLOYEE"];

/** Nav + routes. A role's first visible page is its landing page. */
export const PAGES: Page[] = [
  { path: "/beranda", label: "Beranda", roles: EMP, element: <Home /> },
  { path: "/booking", label: "Booking Harian", roles: EMP, element: <Book /> },
  { path: "/langganan", label: "Langganan", roles: EMP, element: <Subscriptions /> },
  { path: "/riwayat", label: "Riwayat", roles: EMP, element: <History /> },
  { path: "/notifikasi", label: "Notifikasi", roles: EMP, element: <Notifications /> },
  { path: "/keberangkatan", label: "Papan Keberangkatan", roles: ALL, element: <Departures /> },
  { path: "/ganti-password", label: "Ganti Password", roles: ALL, element: <ChangePassword /> },
];
