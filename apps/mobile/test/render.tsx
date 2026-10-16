import { render } from "@testing-library/react-native";
import { DEMO_PASSWORD } from "@bms/mock-api";
import { login } from "../src/api";
import { App } from "../src/App";

/** Log in first (token stays in memory; App reuses it via /me), then render App. */
export async function renderApp(tab?: string, as?: string) {
  if (as) await login(as, DEMO_PASSWORD);
  // @ts-expect-error placeholder App takes no props; Task 3 defines initialTab
  return render(<App initialTab={tab} />);
}
