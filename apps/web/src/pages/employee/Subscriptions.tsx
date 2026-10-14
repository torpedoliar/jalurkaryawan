import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ENDPOINTS, Route, Shift, Subscription, SubscriptionCreateResponse, SubscriptionInput } from "@bms/shared";
import { api } from "../../api";
import { DIRECTION_LABEL, ErrorText, WeekdayPicker, dayNames, today, useAction, useLoad } from "../../ui";
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
  const { busy, error, run } = useAction();
  const routeCode = (id: string) => lookups.data?.[0].find((r) => r.id === id)?.code ?? id;
  const shiftName = (id: string) => lookups.data?.[1].find((s) => s.id === id)?.name ?? id;

  async function submit(e: FormEvent) {
    e.preventDefault();
    // SubscriptionInput.parse throws ZodError inside run, so its message lands in the alert.
    const r = await run(() => api.post(ENDPOINTS.subscriptions, SubscriptionCreateResponse,
      SubscriptionInput.parse({ ...choice, startDate, endDate: endDate || null, weekdays })));
    if (r) { setResult(r); list.reload(); }
  }
  async function end(id: string) {
    if (await run(() => api.post(ENDPOINTS.subscriptionEnd(id), Subscription))) list.reload();
  }
  return (
    <>
      <form className="card" onSubmit={submit}>
        <h1>Langganan</h1>
        <div className="row">
          <TripFields value={choice} onChange={setChoice} />
          <label>Mulai<input type="date" value={startDate} min={today()} onChange={(e) => setStart(e.target.value)} required /></label>
          <label>Sampai (opsional)<input type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <WeekdayPicker value={weekdays} onChange={setWeekdays} />
        <ErrorText error={error ?? list.error} />
        {result && (
          <p role="status">
            Terbooked {result.booked.length} tanggal
            {result.rejected.length > 0 && <>; penuh: {result.rejected.join(", ")}</>}
            {result.skippedCutoff.length > 0 && <>; lewat batas: {result.skippedCutoff.join(", ")}</>}
          </p>
        )}
        <button className="primary" disabled={busy || !choice.stopId || weekdays.length === 0}>Buat langganan</button>
      </form>
      <section className="card">
        <table>
          <thead><tr><th>Rute</th><th>Shift</th><th>Arah</th><th>Periode</th><th>Hari</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.data?.map((s) => (
              <tr key={s.id}>
                <td>{routeCode(s.routeId)}</td>
                <td>{shiftName(s.shiftId)}</td>
                <td>{DIRECTION_LABEL[s.direction]}</td>
                <td>{s.startDate} s/d {s.endDate ?? "seterusnya"}</td>
                <td>{dayNames(s.weekdays)}</td>
                <td>{s.status === "ACTIVE" ? "Aktif" : "Berakhir"}</td>
                <td>{s.status === "ACTIVE" && <button disabled={busy} onClick={() => void end(s.id)}>Akhiri</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
