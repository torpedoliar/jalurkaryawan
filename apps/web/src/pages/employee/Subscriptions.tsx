import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ENDPOINTS, Route, Shift, Subscription, SubscriptionCreateResponse, SubscriptionInput } from "@bms/shared";
import { api } from "../../api";
import { DIRECTION_LABEL, ErrorText, PageHeader, Panel, Stat, StatGrid, WeekdayPicker, dayNames, today, useAction, useLoad } from "../../ui";
import { EMPTY_CHOICE, TripFields, type TripChoice } from "./Book";

/** Spec 6.2 langganan: create, list, end. */
export function Subscriptions() {
  const list = useLoad(() => api.get(ENDPOINTS.mySubscriptions, z.array(Subscription)), []);
  const lookups = useLoad(() => Promise.all([api.get(ENDPOINTS.routes, z.array(Route)), api.get(ENDPOINTS.shifts, z.array(Shift))]), []);
  const [choice, setChoice] = useState<TripChoice>(EMPTY_CHOICE);
  const [startDate, setStart] = useState(today());
  const [endDate, setEnd] = useState("");
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [result, setResult] = useState<SubscriptionCreateResponse | null>(null);
  const [endId, setEndId] = useState("");
  const { busy, error, run } = useAction();
  const routeCode = (id: string) => lookups.data?.[0].find((r) => r.id === id)?.code ?? id;
  const routeColor = (id: string) => lookups.data?.[0].find((r) => r.id === id)?.color ?? "var(--ink)";
  const shiftName = (id: string) => lookups.data?.[1].find((s) => s.id === id)?.name ?? id;
  const active = list.data?.filter((s) => s.status === "ACTIVE").length ?? 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    // SubscriptionInput.parse throws ZodError inside run, so its message lands in the alert.
    const r = await run(() => api.post(ENDPOINTS.subscriptions, SubscriptionCreateResponse,
      SubscriptionInput.parse({ ...choice, startDate, endDate: endDate || null, weekdays })));
    if (r) { setResult(r); list.reload(); }
  }
  async function end(id: string) {
    if (await run(() => api.post(ENDPOINTS.subscriptionEnd(id), Subscription))) { setEndId(""); list.reload(); }
  }
  return (
    <>
      <PageHeader title="Langganan" eyebrow="Perjalanan saya" description="Booking otomatis untuk hari-hari tertentu setiap minggu, tanpa perlu memesan satu per satu." />
      <StatGrid cols={3}>
        <Stat label="Langganan aktif" value={active} hint={`${list.data?.length ?? 0} total langganan`} tone="ok" />
        <Stat label="Berakhir" value={(list.data?.length ?? 0) - active} hint="tidak lagi membuat booking" />
        <Stat label="Hari terpilih" value={weekdays.length} hint="hari dalam seminggu" tone="accent" />
      </StatGrid>
      <Panel className="form" title="Buat langganan baru" description="Pilih perjalanan, rentang tanggal, dan hari aktif. Booking dibuat otomatis pada tanggal yang tersedia.">
        <form className="stack" onSubmit={submit}>
          <div className="row">
            <TripFields value={choice} onChange={setChoice} />
            <label>Mulai<input type="date" value={startDate} min={today()} onChange={(e) => setStart(e.target.value)} required /></label>
            <label>Sampai (opsional)<input type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <WeekdayPicker value={weekdays} onChange={setWeekdays} />
          <ErrorText error={error ?? list.error} />
          {result && (
            <p role="status" className="result-card">
              Terbooked {result.booked.length} tanggal
              {result.rejected.length > 0 && <>; penuh: {result.rejected.join(", ")}</>}
              {result.skippedCutoff.length > 0 && <>; lewat batas: {result.skippedCutoff.join(", ")}</>}
            </p>
          )}
          <div className="row"><button className="primary" disabled={busy || !choice.stopId || weekdays.length === 0}>Buat langganan</button></div>
        </form>
      </Panel>
      <Panel title="Langganan saya">
        {list.data?.length === 0 && <p className="empty-note">Belum ada langganan.</p>}
        {/* Only with rows: no empty header grid, and no loading-pass layout jump. */}
        {list.data && list.data.length > 0 && (
          <table>
            <thead><tr><th>Rute</th><th>Shift</th><th>Arah</th><th>Periode</th><th>Hari</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td><span className="rt"><span className="dot" style={{ background: routeColor(s.routeId) }}>{routeCode(s.routeId)}</span></span></td>
                  <td>{shiftName(s.shiftId)}</td>
                  <td>{DIRECTION_LABEL[s.direction]}</td>
                  <td>{s.startDate} s/d {s.endDate ?? "seterusnya"}</td>
                  <td><span className="tag">{dayNames(s.weekdays)}</span></td>
                  <td>{s.status === "ACTIVE" ? <span className="pill ok">Aktif</span> : <span className="pill">Berakhir</span>}</td>
                  <td><div className="actions">{s.status === "ACTIVE" && (endId === s.id
                    ? <button className="danger armed" disabled={busy} onClick={() => void end(s.id)}>Ya, akhiri</button>
                    : <button className="danger" onClick={() => setEndId(s.id)}>Akhiri</button>)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
