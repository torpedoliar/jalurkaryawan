import { useState } from "react";
import { z } from "zod";
import { AuditLog, ENDPOINTS, Paginated, Role, UserSummary } from "@bms/shared";
import { api } from "../../api";
import { ErrorText, Pager, useLoad } from "../../ui";

const ROLES = ["SUPER_ADMIN", "ADMIN_GA"] as const satisfies readonly Role[];

/** Spec 6.1 Audit log: saring berdasarkan admin, aksi dan rentang tanggal. Terbaru dulu, 50 per halaman. */
const ACTIONS = [
  "SETUP_SUPER_ADMIN", "USER_CREATE", "USER_UPDATE", "USER_IMPORT", "USER_RESET_PASSWORD",
  "USER_SUSPEND", "USER_UNSUSPEND", "USER_DEACTIVATE", "TRIP_CHANGE_BUS", "TRIP_CANCEL",
  "BUS_CAPACITY", "TEMPLATE_CREATE", "TEMPLATE_UPDATE", "VENDOR_CREATE", "VENDOR_UPDATE",
  "BUS_CREATE", "BUS_UPDATE", "SHIFT_CREATE", "SHIFT_UPDATE", "ROUTE_CREATE", "ROUTE_UPDATE",
  "STOP_CREATE", "STOP_UPDATE", "SETTINGS_UPDATE", "BACKUP_RUN", "BACKUP_UPLOAD", "BACKUP_RESTORE",
] as const;

const ACTION_LABEL: Record<string, string> = {
  SETUP_SUPER_ADMIN: "Setup super admin", USER_CREATE: "Buat user", USER_UPDATE: "Ubah user",
  USER_IMPORT: "Import karyawan", USER_RESET_PASSWORD: "Reset password", USER_SUSPEND: "Bekukan booking",
  USER_UNSUSPEND: "Cabut pembekuan", USER_DEACTIVATE: "Nonaktifkan user", TRIP_CHANGE_BUS: "Ganti bus trip",
  TRIP_CANCEL: "Batalkan trip", BUS_CAPACITY: "Ubah kapasitas bus", TEMPLATE_CREATE: "Buat template",
  TEMPLATE_UPDATE: "Ubah template", VENDOR_CREATE: "Buat vendor", VENDOR_UPDATE: "Ubah vendor",
  BUS_CREATE: "Buat bus", BUS_UPDATE: "Ubah bus", SHIFT_CREATE: "Buat shift", SHIFT_UPDATE: "Ubah shift",
  ROUTE_CREATE: "Buat rute", ROUTE_UPDATE: "Ubah rute", STOP_CREATE: "Buat titik", STOP_UPDATE: "Ubah titik",
  SETTINGS_UPDATE: "Ubah pengaturan", BACKUP_RUN: "Backup sekarang", BACKUP_UPLOAD: "Unggah backup",
  BACKUP_RESTORE: "Restore database",
};

export function Audit() {
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const admins = useLoad(
    () => Promise.all(ROLES.map((role) => api.get(ENDPOINTS.users, Paginated(UserSummary), { role }))).then((r) => r.flatMap((p) => p.items)),
    [],
  );
  const logs = useLoad(
    () => api.get(ENDPOINTS.audit, Paginated(AuditLog), { actorId: actorId || undefined, action: action || undefined, from: from || undefined, to: to || undefined, page: String(page) }),
    [actorId, action, from, to, page],
  );
  // Any filter change invalidates the current page number.
  const moved = (f: () => void) => { setPage(1); f(); };

  return (
    <>
      <h1>Audit Log</h1>
      <ErrorText error={logs.error ?? admins.error} />
      <div className="card row">
        <label>Admin
          <select value={actorId} onChange={(e) => moved(() => setActorId(e.target.value))}>
            <option value="">Semua</option>
            {admins.data?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.nik})</option>)}
          </select>
        </label>
        <label>Aksi
          <select value={action} onChange={(e) => moved(() => setAction(e.target.value))}>
            <option value="">Semua</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
          </select>
        </label>
        <label>Dari tanggal<input type="date" value={from} onChange={(e) => moved(() => setFrom(e.target.value))} /></label>
        <label>Sampai tanggal<input type="date" value={to} onChange={(e) => moved(() => setTo(e.target.value))} /></label>
      </div>

      <p>{logs.data?.total ?? 0} log</p>
      <table className="card">
        <caption>Log aktivitas</caption>
        <thead><tr><th>Waktu</th><th>Admin</th><th>Aksi</th><th>Entitas</th><th>ID</th><th>Sebelum</th><th>Sesudah</th></tr></thead>
        <tbody>
          {logs.data?.items.map((a) => (
            <tr key={a.id}>
              <td>{a.createdAt.slice(0, 16).replace("T", " ")}</td>
              <td>{a.actorName}</td>
              <td>{ACTION_LABEL[a.action] ?? a.action}</td>
              <td>{a.entity}</td>
              <td>{a.entityId}</td>
              <td>{JSON.stringify(a.before)}</td>
              <td>{JSON.stringify(a.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager data={logs.data} page={page} onPage={setPage} />
    </>
  );
}
