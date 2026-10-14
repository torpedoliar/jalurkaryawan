import { useCallback, useEffect, useState } from "react";
import { ZodError, type ZodTypeAny } from "zod";
import { read, utils, write } from "xlsx";
import { jakartaDate, type BookingStatus, type DepartureStatus, type Direction } from "@bms/shared";
import { ApiFailure, api, saveBlob } from "./api";

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

export const BOOKING_STATUS_TEXT: Record<BookingStatus, string> = { BOOKED: "Terbooked", CANCELLED: "Dibatalkan", NO_SHOW: "Tidak hadir" };

/** ISO weekday 1 = Senin .. 7 = Minggu. Used by Langganan and the trip template form. */
export const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
export const dayNames = (weekdays: number[]) => weekdays.map((d) => DAYS[d - 1]).join(", ");
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange(v: number[]): void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <fieldset className="row">
      <legend>Hari</legend>
      {DAYS.map((d, i) => (
        <label key={d}><input type="checkbox" checked={value.includes(i + 1)} onChange={() => toggle(i + 1)} />{d}</label>
      ))}
    </fieldset>
  );
}

/** Admin forms: empty id creates (POST list path), otherwise updates (PUT item path). */
export const upsert = <T extends ZodTypeAny>(id: string, list: string, item: (id: string) => string, schema: T, body: unknown) =>
  id ? api.put(item(id), schema, body) : api.post(list, schema, body);

const IMPORT_HEADERS: Record<string, string> = { nik: "nik", nama: "name", departemen: "department", "no hp": "phone" };

/** jsdom 25 has no Blob.arrayBuffer(); FileReader is the path that works in jsdom and in a real browser. */
function fileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

/** First sheet as raw rows with API field names. Validation is the server's job (preview). */
export async function readXlsx(file: File): Promise<unknown[]> {
  let wb;
  try {
    wb = read(await fileBytes(file));
  } catch {
    // SheetJS reads arbitrary bytes as an empty workbook, so a corrupt file would otherwise look like a valid file with no rows.
    throw new Error(`File ${file.name} bukan format Excel atau CSV yang bisa dibaca.`);
  }
  const first = wb.SheetNames[0];
  if (!first) throw new Error("File tidak berisi sheet.");
  const rows = utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[first]!, { defval: "" });
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [IMPORT_HEADERS[k.trim().toLowerCase()] ?? k, v])));
}

/** Prev/next for `Paginated` lists (mock and backend page size 50). */
export function Pager({ data, page, onPage }: { data?: { total: number; pageSize: number }; page: number; onPage(p: number): void }) {
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="row">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</button>
      <span>Halaman {page} dari {pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>Berikutnya</button>
    </div>
  );
}

/** One-sheet workbook; object keys become the header row. */
export function downloadXlsx(rows: Record<string, unknown>[], fileName: string): void {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(rows), "Data");
  saveBlob(new Blob([write(wb, { type: "array", bookType: "xlsx" })]), fileName);
}

/** Occupancy percentage, shared by the three report tables. */
export const pct = (booked: number, capacity: number) => (capacity ? Math.round((booked / capacity) * 100) : 0);
