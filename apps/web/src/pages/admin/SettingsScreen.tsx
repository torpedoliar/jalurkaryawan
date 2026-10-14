import { useState, type FormEvent } from "react";
import { z } from "zod";
import { BackupFile, ENDPOINTS, RestoreRequest, SETTING_GROUPS, Settings, SettingsUpdate, SettingsView } from "@bms/shared";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { ErrorText, errorText, fileBytes, useAction, useLoad } from "../../ui";

/** One row per setting. 19 keys spelled out, so the label copy lives in exactly one place. */
const KEYS: Record<keyof Settings, { label: string; kind: string; placeholder?: string }> = {
  booking_cutoff_minutes: { label: "Batas booking (menit)", kind: "int" },
  generate_days_ahead: { label: "Generate jadwal (hari ke depan)", kind: "int" },
  generate_run_time: { label: "Jam generate jadwal", kind: "time" },
  reminder_minutes: { label: "Pengingat sebelum trip (menit)", kind: "int" },
  push_enabled: { label: "Aktifkan push", kind: "bool" },
  fcm_service_account: { label: "Service account FCM (JSON)", kind: "file" },
  notification_retention_days: { label: "Simpan notifikasi (hari)", kind: "int" },
  login_max_failed: { label: "Maks. login gagal", kind: "int" },
  login_lockout_minutes: { label: "Durasi lock (menit)", kind: "int" },
  login_rate_limit_per_minute: { label: "Batas request login per menit", kind: "int" },
  access_token_minutes: { label: "Masa berlaku access token (menit)", kind: "int" },
  refresh_token_days: { label: "Masa berlaku refresh token (hari)", kind: "int" },
  password_min_length: { label: "Panjang minimum password", kind: "int" },
  backup_run_time: { label: "Jam backup", kind: "time" },
  backup_retention_days: { label: "Simpan backup (hari)", kind: "int" },
  backup_share_enabled: { label: "Salin ke network share", kind: "bool" },
  backup_share_path: { label: "Path share", kind: "text", placeholder: "//host/share/folder" },
  backup_share_username: { label: "Username share", kind: "text" },
  backup_share_password: { label: "Password share", kind: "secret" },
};

type Key = keyof typeof KEYS;
type Draft = Record<string, string | boolean>;
/** The two keys whose values the API never returns. `SECRET_SETTING_KEYS` from @bms/shared is the same list. */
type SecretKey = "fcm_service_account" | "backup_share_password";
/** Secrets never come back from the API, so the draft tracks only what the user typed. `key in pending` marks a send; `""` clears. */
type Pending = Partial<Record<SecretKey, string>>;

const TAB_KEYS = ["booking", "notification", "security", "backup"] as const;
type Tab = (typeof TAB_KEYS)[number];
const TAB_LABEL: Record<Tab, string> = { booking: "Booking", notification: "Notifikasi", security: "Keamanan", backup: "Backup" };
/** The mock answers 200 with {ok, message}: a failed test push is not a failed API call. */
const TestResult = z.object({ ok: z.boolean(), message: z.string() });
/** carry defect 3: the schema argument to api.post parses the RESPONSE, which is the pre-restore file. */
const RestoreResponse = z.object({ preRestore: BackupFile });
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Secrets are not in the draft: the API never returns their values, only `{isSet}`. */
function toDraft(v: SettingsView): Draft {
  const out: Draft = {};
  for (const [k, m] of Object.entries(KEYS)) {
    if (m.kind === "file" || m.kind === "secret") continue;
    out[k] = m.kind === "bool" ? Boolean(v[k as keyof SettingsView]) : String(v[k as keyof SettingsView]);
  }
  return out;
}

/**
 * Module scope, not inside the screen: a component declared in the render body is a new type on
 * every render, so React remounts each input per keystroke - focus is lost mid-typing and every
 * character but the first is dropped.
 */
function Row({ k, value, pending, set, setPending, pickFcm }: {
  k: Key; value: Draft; pending: Pending; set(k: Key): (v: string | boolean) => void;
  setPending(f: (s: Pending) => Pending): void; pickFcm(f: File | undefined): Promise<void>;
}) {
  const m = KEYS[k];
  const id = `s-${k}`;
  return (
    <label htmlFor={id}>
      {m.label}
      {m.kind === "int" && <input id={id} type="number" value={String(value[k])} onChange={(e) => set(k)(e.target.value)} />}
      {m.kind === "time" && <input id={id} type="time" value={String(value[k])} onChange={(e) => set(k)(e.target.value)} />}
      {m.kind === "text" && <input id={id} value={String(value[k])} placeholder={m.placeholder} onChange={(e) => set(k)(e.target.value)} />}
      {m.kind === "bool" && <input id={id} type="checkbox" checked={Boolean(value[k])} onChange={(e) => set(k)(e.target.checked)} />}
      {m.kind === "file" && <input id={id} type="file" accept=".json" onChange={(e) => void pickFcm(e.target.files?.[0])} />}
      {m.kind === "secret" && <input id={id} type="password" value={pending[k as SecretKey] ?? ""} onChange={(e) => setPending((s) => ({ ...s, [k as SecretKey]: e.target.value }))} />}
    </label>
  );
}

export function SettingsScreen() {
  const { signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("booking");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending>({});
  const [msg, setMsg] = useState("");
  const [file, setFile] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const save = useAction();
  const act = useAction();
  const load = useLoad(() => api.get(ENDPOINTS.settings, SettingsView), []);
  const list = useLoad(() => api.get(ENDPOINTS.backups, z.array(BackupFile)), []);

  /** The draft is the single source of truth once the load lands: the server view is only its seed. */
  const value: Draft = draft ?? (load.data ? toDraft(load.data) : {});
  // Functional form: two keystrokes in one batch would otherwise both read the same stale `value`.
  const set = (k: Key) => (v: string | boolean) => setDraft((d) => ({ ...(d ?? value), [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    const body: Record<string, unknown> = {};
    for (const [k, m] of Object.entries(KEYS)) {
      if (m.kind === "file" || m.kind === "secret") { if (k in pending) body[k] = pending[k as SecretKey]; continue; }
      const v = value[k];
      if (m.kind === "int" && (v === "" || v === undefined)) continue;
      body[k] = m.kind === "int" ? Number(v) : v;
    }
    // Same schema as the server: one copy of the ranges, and errorText renders the issue in Indonesian.
    const parsed = SettingsUpdate.safeParse(body);
    if (!parsed.success) { save.setError(errorText(parsed.error)); return; }
    if (!await save.run(() => api.put(ENDPOINTS.settings, SettingsView, parsed.data))) return;
    setDraft(null);
    setPending({});
    setMsg("Pengaturan disimpan.");
    load.reload();
    list.reload();
  }

  /** carry defect 2: File.prototype.text does not exist in jsdom 25; fileBytes + TextDecoder works in both. */
  async function pickFcm(f: File | undefined) {
    if (f) {
      const text = new TextDecoder().decode(await fileBytes(f));
      setPending((p) => ({ ...p, fcm_service_account: text }));
    }
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    const form = new FormData();
    form.append("file", f);
    if (await act.run(() => api.upload(ENDPOINTS.backupUpload, BackupFile, form))) { setMsg("File backup ditambahkan."); list.reload(); }
  }

  return (
    <>
      <h1>Pengaturan</h1>
      <ErrorText error={load.error ?? save.error} />
      {msg && <p role="status">{msg}</p>}
      {load.data && (
        <form onSubmit={submit}>
          <nav>{TAB_KEYS.map((k) => <button key={k} type="button" onClick={() => setTab(k)}>{TAB_LABEL[k]}</button>)}</nav>

          <section className="card">
            {load.data && SETTING_GROUPS[tab].filter((k) => k !== "backup_share_password").map((k) => (
              <Row key={k} k={k as Key} value={value} pending={pending} set={set} setPending={setPending} pickFcm={pickFcm} />
            ))}
            {tab === "backup" && (
              <>
                {/* Label + input for typing, status line for what is stored. The value itself is never rendered. */}
                <p>
                  <label htmlFor="s-backup_share_password">Password share</label>
                  <input
                    id="s-backup_share_password"
                    type="password"
                    value={pending.backup_share_password ?? ""}
                    onChange={(e) => setPending((s) => ({ ...s, backup_share_password: e.target.value }))}
                  />
                </p>
                <p>Status: {load.data.backup_share_password.isSet ? "Tersimpan" : "Belum diisi"}</p>
                <div className="row">
                  <button type="button" onClick={() => setPending((s) => ({ ...s, backup_share_password: "" }))}>Hapus</button>
                  <button type="button" disabled={act.busy} onClick={async () => setMsg((await act.run(() => api.post(ENDPOINTS.settingsTestShare, TestResult)))?.message ?? "")}>Tes koneksi share</button>
                </div>
              </>
            )}
            {tab === "notification" && (
              <div className="row">
                <button type="button" disabled={act.busy} onClick={async () => setMsg((await act.run(() => api.post(ENDPOINTS.settingsTestPush, TestResult)))?.message ?? "")}>Tes kirim push</button>
              </div>
            )}
          </section>

          <button className="primary" disabled={save.busy}>Simpan pengaturan</button>
        </form>
      )}

      {tab === "backup" && (
        <>
          <section className="card">
            <h2>Backup database</h2>
            {/* One alert surface for the whole backup tab: ErrorText is role="alert", so a second
                copy in the restore card would repeat the same message to the user and make
                findByRole("alert") ambiguous. */}
            <ErrorText error={list.error ?? act.error} />
            <div className="row">
              <button type="button" disabled={act.busy} onClick={async () => { if (await act.run(() => api.post(ENDPOINTS.backupRun, BackupFile))) { setMsg("Backup dibuat."); list.reload(); } }}>Backup sekarang</button>
              <label htmlFor="up">File backup<input id="up" type="file" accept=".dump" onChange={(e) => void upload(e.target.files?.[0])} /></label>
            </div>
            {list.data?.length === 0 && <p>Belum ada file backup.</p>}
            {(list.data?.length ?? 0) > 0 && (
              <table>
                <caption>Daftar backup</caption>
                <thead><tr><th>Nama file</th><th>Ukuran</th><th>Dibuat</th><th>Network share</th><th /></tr></thead>
                <tbody>
                  {list.data?.map((b) => (
                    <tr key={b.name}>
                      <td>{b.name}</td><td>{mb(b.sizeBytes)}</td><td>{b.createdAt}</td>
                      <td>{b.copiedToShare ? "Tersalin" : "Belum"}</td>
                      <td><button type="button" onClick={() => void api.download(ENDPOINTS.backupDownload(b.name), b.name)}>Unduh</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <h2>Pulihkan dari backup</h2>
            <p>Seluruh sesi login akan diakhiri setelah pemulihan selesai, dan kamu diminta masuk lagi.</p>
            <label htmlFor="rf">File backup tujuan<input id="rf" value={file} onChange={(e) => setFile(e.target.value)} placeholder="bms-20261014-000000.dump" /></label>
            <label htmlFor="rp">Password kamu<input id="rp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <label htmlFor="rc">Ketik RESTORE<input id="rc" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
            <button
              className="primary"
              disabled={act.busy || !file || confirm !== "RESTORE"}
              onClick={async () => {
                // confirm is the literal the schema requires; the button stays disabled until the field matches.
                const out = await act.run(() => api.post(ENDPOINTS.restore, RestoreResponse, { fileName: file, password: pw, confirm: "RESTORE" }));
                if (out) { setMsg(`Backup pra-pemulihan: ${out.preRestore.name}`); await signOut(); }
              }}
            >
              Pulihkan database
            </button>
          </section>
        </>
      )}
    </>
  );
}
