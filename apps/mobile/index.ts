import { createElement } from "react";
import "./src/operations";
import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Archivo_800ExtraBold, Archivo_900Black } from "@expo-google-fonts/archivo";
import { InterTight_400Regular, InterTight_600SemiBold } from "@expo-google-fonts/inter-tight";
import { JetBrainsMono_400Regular, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import { App } from "./src/App";
import { C } from "./src/ui";

if (process.env.EXPO_PUBLIC_USE_MOCK === "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupServer } = require("msw/native") as typeof import("msw/native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handlers } = require("@bms/mock-api") as typeof import("@bms/mock-api");
  // ponytail: mock-api resolves its own msw copy (same 2.6.8); cast the boundary.
  setupServer(...(handlers as unknown as Parameters<typeof setupServer>)).listen({ onUnhandledRequest: "bypass" });
}

// Font families named in src/ui.tsx `F`. Render waits for them (or a load error, which falls back to the system font).
function Root() {
  const [loaded, error] = useFonts({ Archivo_800ExtraBold, Archivo_900Black, InterTight_400Regular, InterTight_600SemiBold, JetBrainsMono_400Regular, JetBrainsMono_700Bold });
  if (!loaded && !error) return null;
  // One inset wrapper for every screen (login, maintenance, tabs). RN's own SafeAreaView is deprecated and gives no inset on Android.
  return createElement(SafeAreaProvider, null, createElement(SafeAreaView, { style: { flex: 1, backgroundColor: C.bg } }, createElement(StatusBar, { style: "dark" }), createElement(App)));
}

// Expo's SDK type tree may resolve a separate React declaration copy from pnpm.
// Runtime is the same React root; keep the compatibility cast at this external boundary.
registerRootComponent(Root as unknown as Parameters<typeof registerRootComponent>[0]);
