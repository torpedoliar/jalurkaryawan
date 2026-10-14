import { useState, type FormEvent } from "react";
import { ENDPOINTS, ImportCommitResponse, ImportPreview, Paginated, SuspendRequest, TempPassword, UserSummary } from "@bms/shared";
import { api, saveBlob } from "../../api";
import { ErrorText, Pager, readXlsx, today, useAction, useLoad } from "../../ui";

/** Every create/reset returns its passwords exactly once, so keep every pair: newest per user wins. */
export const addPasswords = (list: TempPassword[], fresh: TempPassword[]) =>
  [...list.filter((x) => !fresh.some((p) => p.userId === x.userId)), ...fresh];

/** Spec 5.8: temp passwords exist only here, so the admin downloads the list (never sent back to the server). */
export function TempPasswords({ list, onClose }: { list: TempPassword[]; onClose(): void }) {
  if (list.length === 0) return null;
  const download = () => saveBlob(
    new Blob([["NIK,Password", ...list.map((p) => `${p.nik},${p.tempPassword}`)].join("\r\n")], { type: "text/csv" }),
    "password-awal.csv",
  );
  return (
    <section className="card">
      <table>
        <caption>Password sementara (hanya ditampilkan sekali, wajib diganti saat login)</caption>
        <thead><tr><th>NIK</th><th>Password</th></tr></thead>
        <tbody>{list.map((p) => <tr key={p.userId}><td>{p.nik}</td><td>{p.tempPassword}</td></tr>)}</tbody>
      </table>
      <button onClick={download}>Unduh</button>
      <button onClick={onClose}>Tutup</button>
    </section>
  );
}

/** Spec 5.6: an expired suspension reads as none, same convention as the banner and Book. */
const statusText = (u: UserSummary) => (!u.active ? "Nonaktif" : u.bookingSuspendedUntil && u.bookingSuspendedUntil >= today() ? `Beku s/d ${u.bookingSuspendedUntil}` : "Aktif");

/** Spec 6.1 Karyawan: Excel import (5.9), search, reset password, suspend, deactivate. */
export function Employees() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useLoad(
    () => api.get(ENDPOINTS.users, Paginated(UserSummary), { q: q || undefined, role: "EMPLOYEE", page: String(page) }),
    [q, page],
  );
  const [rows, setRows] = useState<unknown[]>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [passwords, setPasswords] = useState<TempPassword[]>([]);
  const [suspend, setSuspend] = useState<{ id: string; until: string; reason: string }>();
  const [offId, setOffId] = useState("");
  const { busy, error, run } = useAction();

  async function pick(file: File | undefined) {
    setRows(undefined);
    setPreview(undefined);
    if (!file) return;
    const r = await run(() => readXlsx(file));
    if (!r) return;
    setRows(r);
    setPreview(await run(() => api.post(ENDPOINTS.importPreview, ImportPreview, { rows: r })));
  }
  async function commit() {
    const res = await run(() => api.post(ENDPOINTS.importCommit, ImportCommitResponse, { rows }));
    if (!res) return;
    setPasswords((p) => addPasswords(p, res.passwords));
    setRows(undefined);
    setPreview(undefined);
    list.reload();
  }
  async function resetPassword(id: string) {
    const tp = await run(() => api.post(ENDPOINTS.userResetPassword(id), TempPassword));
    if (tp) setPasswords((p) => addPasswords(p, [tp]));
  }
  async function act(path: string) {
    if (await run(() => api.post(path, UserSummary))) { setOffId(""); list.reload(); }
  }
  async function saveSuspend(e: FormEvent) {
    e.preventDefault();
    if (!suspend) return;
    const { id, ...body } = suspend;
    if (await run(() => api.post(ENDPOINTS.userSuspend(id), UserSummary, SuspendRequest.parse(body)))) { setSuspend(undefined); list.reload(); }
  }

  return (
    <>
      <h1>Karyawan</h1>
      <ErrorText error={error ?? list.error} />
      <TempPasswords list={passwords} onClose={() => setPasswords([])} />

      <section className="card">
        <h2>Import Excel</h2>
        <p>Kolom: NIK, Nama, Departemen, No HP. NIK yang sudah ada akan diperbarui.</p>
        <label>File Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => void pick(e.target.files?.[0])} /></label>
        {preview && (
          <>
            <p>Baru: {preview.created.length} · Diperbarui: {preview.updated.length} · Error: {preview.errors.length}</p>
            {preview.errors.length > 0 && (
              <table>
                <caption>Error import</caption>
                <thead><tr><th>Baris</th><th>Pesan</th></tr></thead>
                <tbody>{preview.errors.map((x) => <tr key={x.row}><td>{x.row}</td><td>{x.message}</td></tr>)}</tbody>
              </table>
            )}
            <button
              className="primary"
              disabled={busy || preview.errors.length > 0 || preview.created.length + preview.updated.length === 0}
              onClick={() => void commit()}
            >Simpan import</button>
          </>
        )}
        {rows?.length === 0 && <p>File tidak berisi baris data.</p>}
      </section>

      {suspend && (
        <form className="card row" onSubmit={saveSuspend}>
          <p>Booking user yang belum lewat batas waktu akan dibatalkan.</p>
          <label>Beku sampai<input type="date" min={today()} value={suspend.until} onChange={(e) => setSuspend({ ...suspend, until: e.target.value })} required /></label>
          <label>Alasan<input value={suspend.reason} onChange={(e) => setSuspend({ ...suspend, reason: e.target.value })} required /></label>
          <button className="primary" disabled={busy}>Simpan pembekuan</button>
          <button type="button" onClick={() => setSuspend(undefined)}>Batal</button>
        </form>
      )}

      {/* A new page/search drops rows, so a row-scoped form or confirm would be bound to a row nobody can see. */}
      <label>Cari NIK / nama<input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); setSuspend(undefined); setOffId(""); }} /></label>
      <table className="card">
        <caption>Daftar karyawan</caption>
        <thead><tr><th>NIK</th><th>Nama</th><th>Departemen</th><th>No HP</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.data?.items.map((u) => (
            <tr key={u.id}>
              <td>{u.nik}</td><td>{u.name}</td><td>{u.department}</td><td>{u.phone}</td><td>{statusText(u)}</td>
              <td>
                {u.active && (
                  <>
                    <button disabled={busy} onClick={() => void resetPassword(u.id)}>Reset password</button>
                    {u.bookingSuspendedUntil && u.bookingSuspendedUntil >= today()
                      ? <button disabled={busy} onClick={() => void act(ENDPOINTS.userUnsuspend(u.id))}>Cabut pembekuan</button>
                      : <button onClick={() => setSuspend({ id: u.id, until: "", reason: "" })}>Bekukan</button>}
                    {offId === u.id
                      ? <button disabled={busy} onClick={() => void act(ENDPOINTS.userDeactivate(u.id))}>Ya, nonaktifkan</button>
                      : <button onClick={() => setOffId(u.id)}>Nonaktifkan</button>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager data={list.data} page={page} onPage={(p) => { setPage(p); setSuspend(undefined); setOffId(""); }} />
    </>
  );
}
