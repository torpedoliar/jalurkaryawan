import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

async function start() {
  if (import.meta.env.VITE_USE_MOCK === "true") {
    const [{ setupWorker }, { handlers }] = await Promise.all([import("msw/browser"), import("@bms/mock-api")]);
    await setupWorker(...handlers).start({ onUnhandledRequest: "bypass" });
  }
  createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);
}
void start();
