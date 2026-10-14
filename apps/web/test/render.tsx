import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DEMO_PASSWORD } from "@bms/mock-api";
import { login } from "../src/api";
import { App } from "../src/App";

/** Log in first (token stays in memory; App reuses it via /me), then render App at `path`. */
export async function renderApp(path: string, as?: string) {
  if (as) await login(as, DEMO_PASSWORD);
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  return { user };
}
