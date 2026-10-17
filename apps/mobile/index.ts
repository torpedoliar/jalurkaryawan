import { createElement } from "react";
import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { App } from "./src/App";

if (process.env.EXPO_PUBLIC_USE_MOCK === "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupServer } = require("msw/native") as typeof import("msw/native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handlers } = require("@bms/mock-api") as typeof import("@bms/mock-api");
  // ponytail: mock-api resolves its own msw copy (same 2.6.8); cast the boundary.
  setupServer(...(handlers as unknown as Parameters<typeof setupServer>)).listen({ onUnhandledRequest: "bypass" });
}

// One inset wrapper for every screen (login, maintenance, tabs). RN's own SafeAreaView is deprecated and gives no inset on Android.
registerRootComponent(() => createElement(SafeAreaProvider, null, createElement(SafeAreaView, { style: { flex: 1 } }, createElement(StatusBar, { style: "auto" }), createElement(App))));
