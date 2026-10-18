import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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

/* Design tokens: docs/design/mockup-a-plus-b.html ("Jalur Karyawan"), same values as apps/web/src/styles.css (light). */
export const C = {
  bg: "#EEF1F4", surface: "#FFFFFF", sunk: "#E3E8EE", ink: "#10161D", muted: "#5A6573", line: "#CDD5DE",
  signal: "#F5B700", signalInk: "#10161D", full: "#C8312B",
};
/** Departure board is always dark, like station signage. */
export const BOARD = { bg: "#0D1218", ink: "#E8EDF2", dim: "#7F8B99", rule: "#1C252F", head: "#FFC72C", mine: "#2A2410" };
/** Families registered by useFonts in index.ts; until loaded (and in tests) RN falls back to the system font. */
export const F = {
  display: "Archivo_800ExtraBold", black: "Archivo_900Black",
  body: "InterTight_400Regular", bodyBold: "InterTight_600SemiBold",
  mono: "JetBrainsMono_400Regular", monoBold: "JetBrainsMono_700Bold",
};

export const S = StyleSheet.create({
  eyebrow: { fontFamily: F.monoBold, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: C.muted },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, gap: 8 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.ink, fontFamily: F.body, fontSize: 15 },
  text: { color: C.ink, fontFamily: F.body, fontSize: 15 },
  title: { fontFamily: F.black, fontSize: 30, color: C.ink },
  screen: { gap: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});

/** Screen title: mono eyebrow over a heavy display heading. */
export function Title({ children, kicker }: { children: string; kicker?: string }) {
  return (
    <View style={{ gap: 2 }}>
      {kicker && <Text style={S.eyebrow}>{kicker}</Text>}
      <Text accessibilityRole="header" style={S.title}>{children}</Text>
    </View>
  );
}

/** Primary = yellow signal CTA (one per screen); otherwise an outlined secondary action. */
export function Btn({ title, onPress, disabled = false, primary = false }: { title: string; onPress(): void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: primary ? "stretch" : "flex-start", alignItems: "center", justifyContent: "center", minHeight: 44,
        paddingHorizontal: 16, borderRadius: primary ? 14 : 10, opacity: disabled ? 0.45 : 1,
        backgroundColor: primary ? C.signal : pressed ? C.sunk : "transparent", borderWidth: primary ? 0 : 1, borderColor: C.line,
      })}
    >
      <Text style={{ color: primary ? C.signalInk : C.ink, fontFamily: primary ? F.display : F.bodyBold, fontSize: primary ? 16 : 14 }}>{title}</Text>
    </Pressable>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <Text accessibilityRole="alert" style={{ color: C.full, fontFamily: F.bodyBold }}>{error}</Text> : null;
}

const STATUS_LABEL: Record<DepartureStatus, string> = { AVAILABLE: "TERSEDIA", ALMOST: "HAMPIR", FULL: "PENUH", CANCELLED: "BATAL" };
const STATUS_COLOR: Record<DepartureStatus, [string, string]> = {
  AVAILABLE: ["#173A27", "#5BE08F"], ALMOST: ["#3D2C0C", "#FFC24D"], FULL: ["#43171A", "#FF7A73"], CANCELLED: ["#43171A", "#FF7A73"],
};
export function StatusBadge({ status }: { status: DepartureStatus }) {
  const [bg, fg] = STATUS_COLOR[status];
  return (
    <Text style={{ alignSelf: "flex-start", backgroundColor: bg, color: fg, fontFamily: F.monoBold, fontSize: 11, letterSpacing: 0.6, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, overflow: "hidden" }}>
      {STATUS_LABEL[status]}
    </Text>
  );
}

/** Spec 6.2 "warna/kode rute": route-line dot; the route code text beside it carries the meaning. */
export function RouteSwatch({ color }: { color: string }) {
  return <View testID="route-swatch" style={{ width: 14, height: 14, borderRadius: 7, marginRight: 8, backgroundColor: color }} />;
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
      <Text accessibilityRole="header" style={S.eyebrow}>{label}</Text>
      <View style={S.chips}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          testID={`chip-${o.value}`}
          onPress={() => onChange(o.value)}
          style={chip(o.value === value)}
        >
          <Text style={chipText(o.value === value)}>{o.label}</Text>
        </Pressable>
      ))}
      </View>
    </>
  );
}

/** Selected chip/tab = ink fill, like the web's aria-pressed buttons. */
export const chip = (on: boolean) => ({ paddingHorizontal: 12, minHeight: 40, justifyContent: "center" as const, borderRadius: 10, borderWidth: 1, borderColor: on ? C.ink : C.line, backgroundColor: on ? C.ink : C.surface });
export const chipText = (on: boolean) => ({ color: on ? C.bg : C.ink, fontFamily: on ? F.bodyBold : F.body, fontSize: 14 });

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange(v: number[]): void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <>
      <Text accessibilityRole="header" style={S.eyebrow}>Hari</Text>
      <View style={S.chips}>
      {DAYS.map((d, i) => (
        <Pressable
          key={d}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: value.includes(i + 1) }}
          accessibilityLabel={d}
          onPress={() => toggle(i + 1)}
          style={chip(value.includes(i + 1))}
        >
          <Text style={chipText(value.includes(i + 1))}>{d}</Text>
        </Pressable>
      ))}
      </View>
    </>
  );
}
