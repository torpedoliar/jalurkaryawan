import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Bus, Direction, ENDPOINTS, Route, Shift, ShiftInput, TripTemplate, TripTemplateInput } from "@bms/shared";
import { api } from "../../api";
import { DAYS, DIRECTION_LABEL, ErrorText, PageHeader, Panel, Stat, StatGrid, WeekdayPicker, YesNo, dayNames, upsert, useAction, useLoad } from "../../ui";

const NEW_SHIFT = { id: "", name: "", startTime: "", endTime: "" };
const NEW_TEMPLATE = {
  id: "", routeId: "", shiftId: "", direction: "" as Direction | "", busId: "",
  departureTime: "", dayOffset: 0 as 0 | 1, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
};

/** Spec 6.1: shifts and the weekly trip templates the nightly job generates trips from. */
export function ShiftsTemplates() {
  const shifts = useLoad(() => api.get(ENDPOINTS.shifts, z.array(Shift)), []);
  const templates = useLoad(() => api.get(ENDPOINTS.templates, z.array(TripTemplate)), []);
  const lookups = useLoad(() => Promise.all([api.get(ENDPOINTS.routes, z.array(Route)), api.get(ENDPOINTS.buses, z.array(Bus))]), []);
  const [routes, buses] = lookups.data ?? [[], []];
  const [sh, setSh] = useState(NEW_SHIFT);
  const [t, setT] = useState(NEW_TEMPLATE);
  const { busy, error, run } = useAction();
  const name = <T extends { id: string }>(rows: T[] | undefined, id: string, f: (r: T) => string) => {
    const row = rows?.find((r) => r.id === id);
    return row ? f(row) : id;
  };

  async function saveShift(e: FormEvent) {
    e.preventDefault();
    const { id, ...rest } = sh;
    if (await run(() => upsert(id, ENDPOINTS.shifts, ENDPOINTS.shift, Shift, ShiftInput.parse(rest)))) { setSh(NEW_SHIFT); shifts.reload(); }
  }
  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    const { id, ...rest } = t;
    if (await run(() => upsert(id, ENDPOINTS.templates, ENDPOINTS.template, TripTemplate, TripTemplateInput.parse(rest)))) { setT(NEW_TEMPLATE); templates.reload(); }
  }

  return (
    <>
      <PageHeader title="Shift & Jadwal" eyebrow="Data master" description="Shift kerja dan jadwal trip mingguan. Trip harian dibuat otomatis dari jadwal yang aktif." />
      <ErrorText error={error ?? shifts.error ?? templates.error ?? lookups.error} />
      <StatGrid>
        <Stat label="Shift" value={shifts.data?.length ?? 0} hint="jam kerja karyawan" />
        <Stat label="Jadwal trip" value={templates.data?.length ?? 0} hint="template mingguan" tone="accent" />
        <Stat label="Jadwal aktif" value={templates.data?.filter((t) => t.active).length ?? 0} hint="membuat trip otomatis" tone="ok" />
        <Stat label="Jadwal nonaktif" value={templates.data?.filter((t) => !t.active).length ?? 0} hint="tidak dijalankan" />
      </StatGrid>

      <h2 className="section-title">Shift kerja</h2>
      <div className="grid-2">
        <Panel className={sh.id ? "editing" : "form"} title={sh.id ? `Ubah shift: ${sh.name}` : "Tambah shift"}>
          <form className="row" onSubmit={saveShift}>
            <label>Nama shift<input value={sh.name} onChange={(e) => setSh({ ...sh, name: e.target.value })} required /></label>
            <label>Jam mulai<input type="time" value={sh.startTime} onChange={(e) => setSh({ ...sh, startTime: e.target.value })} required /></label>
            <label>Jam selesai<input type="time" value={sh.endTime} onChange={(e) => setSh({ ...sh, endTime: e.target.value })} required /></label>
            <button className="primary" disabled={busy}>Simpan shift</button>
            {sh.id && <button type="button" onClick={() => setSh(NEW_SHIFT)}>Batal</button>}
          </form>
        </Panel>
        <Panel>
          <table>
            <caption>Daftar shift</caption>
            <thead><tr><th>Nama</th><th>Mulai</th><th>Selesai</th><th></th></tr></thead>
            <tbody>
              {shifts.data?.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td><td>{x.startTime}</td><td>{x.endTime}</td>
                  <td><div className="actions"><button onClick={() => setSh({ ...x })}>Ubah</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {templates.data && (
        <Panel title="Sebaran jadwal mingguan" description="Jumlah jadwal aktif yang berangkat pada tiap hari.">
          <div className="week-strip">
            {DAYS.map((d, i) => (
              <div key={d}><span>{d}</span><b>{templates.data!.filter((t) => t.active && t.weekdays.includes(i + 1)).length}</b></div>
            ))}
          </div>
        </Panel>
      )}

      <h2 className="section-title">Jadwal trip mingguan</h2>
      <Panel className={t.id ? "editing" : "form"} title={t.id ? "Ubah jadwal" : "Tambah jadwal"}>
        <form className="stack" onSubmit={saveTemplate}>
          <div className="row">
            <label>Rute
              <select value={t.routeId} onChange={(e) => setT({ ...t, routeId: e.target.value })} required>
                <option value="">Pilih</option>
                {routes.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}
              </select>
            </label>
            <label>Shift
              <select value={t.shiftId} onChange={(e) => setT({ ...t, shiftId: e.target.value })} required>
                <option value="">Pilih</option>
                {shifts.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label>Arah
              <select value={t.direction} onChange={(e) => setT({ ...t, direction: e.target.value as Direction })} required>
                <option value="">Pilih</option>
                {Direction.options.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
              </select>
            </label>
            <label>Bus
              <select value={t.busId} onChange={(e) => setT({ ...t, busId: e.target.value })} required>
                <option value="">Pilih</option>
                {buses.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.plate} ({x.capacity})</option>)}
              </select>
            </label>
            <label>Jam berangkat<input type="time" value={t.departureTime} onChange={(e) => setT({ ...t, departureTime: e.target.value })} required /></label>
          </div>
          <div className="row">
            <WeekdayPicker value={t.weekdays} onChange={(weekdays) => setT({ ...t, weekdays })} />
            <label><input type="checkbox" checked={t.dayOffset === 1} onChange={(e) => setT({ ...t, dayOffset: e.target.checked ? 1 : 0 })} />Berangkat esok hari (H+1)</label>
            <label><input type="checkbox" checked={t.active} onChange={(e) => setT({ ...t, active: e.target.checked })} />Aktif</label>
          </div>
          <div className="row">
            <button className="primary" disabled={busy}>Simpan jadwal</button>
            {t.id && <button type="button" onClick={() => setT(NEW_TEMPLATE)}>Batal</button>}
          </div>
        </form>
      </Panel>
      <Panel>
        <div className="table-scroll tall"><table>
          <caption>Jadwal trip</caption>
          <thead><tr><th>Rute</th><th>Shift</th><th>Arah</th><th>Bus</th><th>Jam</th><th>Hari</th><th>Aktif</th><th></th></tr></thead>
          <tbody>
            {templates.data?.map((x) => (
              <tr key={x.id}>
                <td>{name(routes, x.routeId, (r) => r.code)}</td>
                <td>{name(shifts.data, x.shiftId, (s) => s.name)}</td>
                <td>{DIRECTION_LABEL[x.direction]}</td>
                <td>{name(buses, x.busId, (b) => b.plate)}</td>
                <td>{x.departureTime}{x.dayOffset === 1 && " (H+1)"}</td>
                <td>{dayNames(x.weekdays)}</td>
                <td><YesNo on={x.active} /></td>
                <td><div className="actions"><button onClick={() => setT({ ...x })}>Ubah</button></div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
    </>
  );
}
