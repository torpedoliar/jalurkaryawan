import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ZodError } from "zod";
import { jakartaDate, type BookingStatus, type DepartureStatus, type Direction } from "@bms/shared";
import { ApiFailure } from "./api";

const NUM: Record<string, string | undefined> = { string: "karakter", array: "elemen" };

/**
 * Zod's own copy is English. Codes whose message the schema author wrote in
 * Indonesian (`custom`, and `too_small`/`too_big`/`invalid_string` carrying a
 * custom message) pass through verbatim; only Zod-generated English is mapped.
 */
function zodMessage(i: ZodError["issues"][number]): string {
  if (i.code === "custom" || (i.code !== "invalid_type" && "message" in i && i.message && !isEnglish(i.message))) return i.message;
  const at = i.path.join(".") || "body";
  switch (i.code) {
    case "unrecognized_keys": return "Ada kolom yang tidak dikenali.";
    case "invalid_type": return i.received === "undefined" ? `${at} wajib diisi.` : `${at}: format tidak sesuai.`;
    case "invalid_string": return `${at}: format tidak sesuai.`;
    case "too_small": return `${at}: minimal ${i.minimum} ${NUM[i.type] ?? ""}`.trimEnd() + ".";
    case "too_big": return `${at}: maksimal ${i.maximum} ${NUM[i.type] ?? ""}`.trimEnd() + ".";
    case "not_multiple_of": return `${at}: harus kelipatan ${i.multipleOf}.`;
    default: return `${at}: ${i.message}`;
  }
}

/** All of @bms/shared's own messages are Indonesian, so English prose is always Zod-generated. */
const isEnglish = (m: string) => /must|invalid|expected|required|unrecognized|multiple|finite/i.test(m);

export function errorText(e: unknown): string {
  if (e instanceof ApiFailure) return e.message;
  const i = e instanceof ZodError ? e.issues[0] : undefined;
  return i ? zodMessage(i) : "Terjadi kesalahan. Coba lagi.";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  return error ? <Text accessibilityRole="alert" style={{ color: "#b42318" }}>{error}</Text> : null;
}

const STATUS_LABEL: Record<DepartureStatus, string> = { AVAILABLE: "TERSEDIA", ALMOST: "HAMPIR", FULL: "PENUH", CANCELLED: "BATAL" };
export function StatusBadge({ status }: { status: DepartureStatus }) {
  return <Text style={{ fontWeight: "600", fontSize: 12 }}>{STATUS_LABEL[status]}</Text>;
}

/** Spec 6.2 "warna/kode rute": decorative dot; the route code beside it carries the meaning. */
export function RouteSwatch({ color }: { color: string }) {
  return <View testID="route-swatch" style={{ width: 12, height: 12, borderRadius: 6, marginRight: 6, backgroundColor: color }} />;
}

export const DIRECTION_LABEL: Record<Direction, string> = { PICKUP: "Jemput", DROPOFF: "Antar" };
export const hhmm = (iso: string) => iso.slice(11, 16);
/** Operational date (Asia/Jakarta) from the device clock. */
export const today = () => jakartaDate(new Date());

export const BOOKING_STATUS_TEXT: Record<BookingStatus, string> = { BOOKED: "Terbooked", CANCELLED: "Dibatalkan", NO_SHOW: "Tidak hadir" };

/** ISO weekday 1 = Senin .. 7 = Minggu. */
export const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
export const dayNames = (weekdays: number[]) => weekdays.map((d) => DAYS[d - 1]).join(", ");

export function ChipSelect<T extends string>({ label, options, value, onChange }: {
  label: string; options: { value: T; label: string }[]; value: T; onChange(v: T): void;
}) {
  return (
    <>
      <Text accessibilityRole="header">{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          testID={`chip-${o.value}`}
          onPress={() => onChange(o.value)}
          style={{ padding: 8, margin: 2 }}
        >
          <Text style={{ fontWeight: o.value === value ? "700" : "400" }}>{o.label}</Text>
        </Pressable>
      ))}
      </View>
    </>
  );
}

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange(v: number[]): void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <>
      <Text accessibilityRole="header">Hari</Text>
      {DAYS.map((d, i) => (
        <Pressable
          key={d}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: value.includes(i + 1) }}
          accessibilityLabel={d}
          onPress={() => toggle(i + 1)}
        >
          <Text style={{ fontWeight: value.includes(i + 1) ? "700" : "400" }}>{d}</Text>
        </Pressable>
      ))}
    </>
  );
}
