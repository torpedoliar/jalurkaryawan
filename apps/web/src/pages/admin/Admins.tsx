import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ENDPOINTS, Paginated, TempPassword, UserInput, UserSummary, Vendor, type Role } from "@bms/shared";
import { api } from "../../api";
import { ErrorText, useAction, useLoad } from "../../ui";
import { TempPasswords } from "./Employees";

const ROLES = ["SUPER_ADMIN", "ADMIN_GA", "VENDOR"] as const satisfies readonly Role[];
const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: "Super Admin", ADMIN_GA: "Admin GA", VENDOR: "Vendor" };
const NEW_ACCOUNT = { id: "", nik: "", name: "", department: "", phone: "", role: "ADMIN_GA" as Role, vendorId: "" };

/** Spec 6.1 (Super Admin only): admin and vendor operator accounts. */
export function Admins() {
  // One request per role: the user list is sorted by NIK, so a single page would mix in employees.
  const list = useLoad(
    () => Promise.all(ROLES.map((role) => api.get(ENDPOINTS.users, Paginated(UserSummary), { role }))).then((r) => r.flatMap((p) => p.items)),
    [],
  );
  const vendors = useLoad(() => api.get(ENDPOINTS.vendors, z.array(Vendor)), []);
  const [f, setF] = useState(NEW_ACCOUNT);
  const [passwords, setPasswords] = useState<TempPassword[]>([]);
  const [offId, setOffId] = useState("");
  const { busy, error, run } = useAction();
  const vendorName = (id: string | null) => (id ? vendors.data?.find((v) => v.id === id)?.name ?? id : "");

  async function save(e: FormEvent) {
    e.preventDefault();
    const { id, vendorId, ...rest } = f;
    // Split so each run() call has one concrete return type; the refine input type is wider than the output.
    const res = id
      ? await run(() => {
          const body = UserInput.parse({ ...rest, vendorId: rest.role === "VENDOR" ? vendorId || null : null });
          return api.put(ENDPOINTS.user(id), UserSummary, body);
        })
      : await run(() => {
          const body = UserInput.parse({ ...rest, vendorId: rest.role === "VENDOR" ? vendorId || null : null });
          return api.post(ENDPOINTS.users, TempPassword, body);
        });
    if (!res) return;
    if ("tempPassword" in res) setPasswords([res]);
    setF(NEW_ACCOUNT);
    list.reload();
  }
  async function resetPassword(id: string) {
    const tp = await run(() => api.post(ENDPOINTS.userResetPassword(id), TempPassword));
    if (tp) setPasswords([tp]);
  }
  async function deactivate(id: string) {
    if (await run(() => api.post(ENDPOINTS.userDeactivate(id), UserSummary))) { setOffId(""); list.reload(); }
  }

  return (
    <>
      <h1>Admin &amp; Vendor</h1>
      <ErrorText error={error ?? list.error ?? vendors.error} />
      <TempPasswords list={passwords} onClose={() => setPasswords([])} />
      <form className="card row" onSubmit={save}>
        <label>NIK<input value={f.nik} onChange={(e) => setF({ ...f, nik: e.target.value })} required /></label>
        <label>Nama<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label>Departemen<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
        <label>No HP<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>Role
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        {f.role === "VENDOR" && (
          <label>Vendor
            <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}>
              <option value="">Pilih</option>
              {vendors.data?.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        )}
        <button className="primary" disabled={busy}>Simpan akun</button>
        {f.id && <button type="button" onClick={() => setF(NEW_ACCOUNT)}>Batal</button>}
      </form>
      <table className="card">
        <caption>Akun admin &amp; vendor</caption>
        <thead><tr><th>NIK</th><th>Nama</th><th>Role</th><th>Vendor</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.nik}</td><td>{u.name}</td><td>{ROLE_LABEL[u.role]}</td><td>{vendorName(u.vendorId)}</td><td>{u.active ? "Aktif" : "Nonaktif"}</td>
              <td>
                {u.active && (
                  <>
                    <button onClick={() => setF({ id: u.id, nik: u.nik, name: u.name, department: u.department, phone: u.phone, role: u.role, vendorId: u.vendorId ?? "" })}>Ubah</button>
                    <button disabled={busy} onClick={() => void resetPassword(u.id)}>Reset password</button>
                    {offId === u.id
                      ? <button disabled={busy} onClick={() => void deactivate(u.id)}>Ya, nonaktifkan</button>
                      : <button onClick={() => setOffId(u.id)}>Nonaktifkan</button>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
