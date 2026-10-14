import { useCallback, useEffect, useState } from "react";
import { ZodError } from "zod";
import { jakartaDate, type DepartureStatus, type Direction } from "@bms/shared";
import { ApiFailure } from "./api";

export function errorText(e: unknown): string {
  if (e instanceof ApiFailure) return e.message;
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Data tidak valid.";
  return "Terjadi kesalahan. Coba lagi.";
}

/** Load on mount and whenever deps change; stale responses are dropped. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fn().then((d) => { if (live) setData(d); }, (e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [...deps, tick]);
  return { data, error, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/** Wrap a mutation: tracks busy, shows the server message, resolves undefined on failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <p role="alert" className="error">{error}</p> : null;
}

const STATUS_LABEL: Record<DepartureStatus, string> = { AVAILABLE: "TERSEDIA", ALMOST: "HAMPIR", FULL: "PENUH", CANCELLED: "BATAL" };
export function StatusBadge({ status }: { status: DepartureStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export const DIRECTION_LABEL: Record<Direction, string> = { PICKUP: "Jemput", DROPOFF: "Antar" };
export const hhmm = (iso: string) => iso.slice(11, 16);
/** Operational date (Asia/Jakarta) from the browser clock. */
export const today = () => jakartaDate(new Date());
