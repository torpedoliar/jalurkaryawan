import type { ReactNode } from "react";
import { Role } from "@bms/shared";
import { ChangePassword } from "./pages/ChangePassword";
import { Departures } from "./pages/Departures";

export interface Page { path: string; label: string; roles: readonly Role[]; element: ReactNode }

const ALL = Role.options;

/** Nav + routes. A role's first visible page is its landing page. */
export const PAGES: Page[] = [
  { path: "/keberangkatan", label: "Papan Keberangkatan", roles: ALL, element: <Departures /> },
  { path: "/ganti-password", label: "Ganti Password", roles: ALL, element: <ChangePassword /> },
];
