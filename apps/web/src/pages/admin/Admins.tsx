import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ENDPOINTS, Paginated, TempPassword, UserInput, UserSummary, Vendor, type Role } from "@bms/shared";
import { api } from "../../api";
import { useMe } from "../../auth";
import { ErrorText, PageHeader, Panel, Stat, StatGrid, useAction, useLoad } from "../../ui";
import { addPasswords, TempPasswords } from "./Employees";

const ALL_ROLES = ["SUPER_ADMIN", "ADMIN_GA", "VENDOR", "DRIVER"] as const satisfies readonly Role[];
const GA_ROLES = ["VENDOR", "DRIVER"] as const satisfies readonly Role[];
const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: "Super Admin", ADMIN_GA: "Admin GA", VENDOR: "Vendor", DRIVER: "Sopir" };
const NEW_ACCOUNT = { id: "", nik: "", name: "", department: "", phone: "", role: "ADMIN_GA" as Role, vendorId: "" };

/** Spec 6.1: admin and vendor operator accounts. ADMIN_GA manages vendor accounts only (the API allows just that). */
export function Admins() {
  const me = useMe();
  // Spec 6.1: vendor accounts belong to ADMIN_GA, admin accounts to SUPER_ADMIN only. Scoping the
  // fetch and the select keeps a GA admin from listing or creating a row the API would 403 on.
  const roles = me.role === "SUPER_ADMIN" ? ALL_ROLES : GA_ROLES;
  // One request per role: the user list is sorted by NIK, so a single page would mix in employees.
  const list = useLoad(
    () => Promise.all(roles.map((role) => api.get(ENDPOINTS.users, Paginated(UserSummary), { role }))).then((r) => r.flatMap((p) => p.items)),
    [roles],
  );
  const vendors = useLoad(() => api.get(ENDPOINTS.vendors, z.array(Vendor)), []);
  const [f, setF] = useState<typeof NEW_ACCOUNT>({ ...NEW_ACCOUNT, role: roles[0]! });
  const [passwords, setPasswords] = useState<TempPassword[]>([]);
  const [offId, setOffId] = useState("");
  const [resetId, setResetId] = useState("");
  const { busy, error, run } = useAction();
  const vendorName = (id: string | null) => (id ? vendors.data?.find((v) => v.id === id)?.name ?? id : "");

  const defaults = { ...NEW_ACCOUNT, role: roles[0]! };

  async function save(e: FormEvent) {
    e.preventDefault();
    const { id, vendorId, ...rest } = f;
    const res = await run(async () => {
      const body = UserInput.parse({ ...rest, vendorId: rest.role === "VENDOR" || rest.role === "DRIVER" ? vendorId || null : null });
      return id ? await api.put(ENDPOINTS.user(id), UserSummary, body) : await api.post(ENDPOINTS.users, TempPassword, body);
    });
    if (!res) return;
    if ("tempPassword" in res) setPasswords((p) => addPasswords(p, [res]));
    setF(defaults);
    reload();
  }
  async function resetPassword(id: string) {
    const tp = await run(() => api.post(ENDPOINTS.userResetPassword(id), TempPassword));
    if (tp) { setResetId(""); setPasswords((p) => addPasswords(p, [tp])); }
  }
  async function deactivate(id: string) {
    if (await run(() => api.post(ENDPOINTS.userDeactivate(id), UserSummary))) reload();
  }
  // A reload replaces every row, so an armed id would point at a row nobody can see any more.
  const reload = () => { setOffId(""); setResetId(""); list.reload(); };

  return (
    <>
      <PageHeader
        title="Admin & Vendor"
        eyebrow="Pengguna"
        description={me.role === "SUPER_ADMIN" ? "Akun pengelola sistem (Super Admin, Admin GA), operator vendor, dan sopir. Sopir terikat ke vendor pemilik bus yang dikemudikannya." : "Akun operator vendor dan sopir. Akun admin hanya bisa dikelola Super Admin."}
      />
      <ErrorText error={error ?? list.error ?? vendors.error} />
      <TempPasswords list={passwords} onClose={() => setPasswords([])} />
      {list.data && (
        <StatGrid>
          <Stat label="Total akun" value={list.data.length} hint="admin, vendor, dan sopir" />
          <Stat label="Admin" value={list.data.filter((u) => u.role === "SUPER_ADMIN" || u.role === "ADMIN_GA").length} hint="pengelola sistem" tone="accent" />
          <Stat label="Vendor" value={list.data.filter((u) => u.role === "VENDOR").length} hint="operator armada" />
          <Stat label="Sopir" value={list.data.filter((u) => u.role === "DRIVER" && u.active).length} hint="aktif" tone="ok" />
        </StatGrid>
      )}
      <Panel className={f.id ? "editing" : "form"} title={f.id ? `Ubah akun: ${f.name}` : "Tambah akun"} description={f.id ? undefined : "Password awal akun baru ditampilkan sekali setelah disimpan."}>
        <form className="row" onSubmit={save}>
          <label>NIK<input value={f.nik} onChange={(e) => setF({ ...f, nik: e.target.value })} required /></label>
          <label>Nama<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label>Departemen<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
          <label>No HP<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label>Role
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          {(f.role === "VENDOR" || f.role === "DRIVER") && (
            <label>Vendor
              <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}>
                <option value="">Pilih</option>
                {vendors.data?.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          <button className="primary" disabled={busy}>Simpan akun</button>
          {f.id && <button type="button" onClick={() => setF(defaults)}>Batal</button>}
        </form>
      </Panel>
      <Panel>
        <table>
          <caption>Akun admin &amp; vendor</caption>
          <thead><tr><th>NIK</th><th>Nama</th><th>Role</th><th>Vendor</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.data?.map((u) => (
              <tr key={u.id}>
                <td>{u.nik}</td><td><span className="user-cell"><span className="avatar sm" aria-hidden="true">{u.name.slice(0, 1).toUpperCase()}</span><span>{u.name}</span></span></td><td><span className="pill">{ROLE_LABEL[u.role]}</span></td><td>{vendorName(u.vendorId)}</td>
                <td>{u.active ? <span className="pill ok">Aktif</span> : <span className="pill bad">Nonaktif</span>}</td>
                <td>
                  {u.active && (
                    <div className="actions">
                      <button onClick={() => setF({ id: u.id, nik: u.nik, name: u.name, department: u.department, phone: u.phone, role: u.role, vendorId: u.vendorId ?? "" })}>Ubah</button>
                      {resetId === u.id
                        ? <button className="danger armed" disabled={busy} onClick={() => void resetPassword(u.id)}>Ya, reset password</button>
                        : <button onClick={() => setResetId(u.id)}>Reset password</button>}
                      {offId === u.id
                        ? <button className="danger armed" disabled={busy} onClick={() => void deactivate(u.id)}>Ya, nonaktifkan</button>
                        : <button className="danger" onClick={() => setOffId(u.id)}>Nonaktifkan</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
