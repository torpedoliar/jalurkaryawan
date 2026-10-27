import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

async function start() {
  if (import.meta.env.VITE_USE_MOCK === "true") {
    const [{ setupWorker }, { handlers }] = await Promise.all([import("msw/browser"), import("@bms/mock-api")]);
    if (import.meta.env.VITE_DEMO_PROFILE !== "legacy") { const { useKarawangDemo } = await import("@bms/mock-api"); useKarawangDemo(); }
    await setupWorker(...handlers).start({ onUnhandledRequest: "bypass" });
  }
  createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></BrowserRouter></StrictMode>);
}
void start();
