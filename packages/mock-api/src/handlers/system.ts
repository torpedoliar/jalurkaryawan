import { ENDPOINTS, ERROR_MESSAGES, RestoreRequest, SECRET_SETTING_KEYS, SettingsUpdate, toSettingsView, type BackupFile, type Settings } from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, audit, nowIso, type Db } from "../db";
import { handle, parseBody, type Ctx } from "../http";
import { p } from "./util";

const superAdmin = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ["SUPER_ADMIN"] });
const MAGIC = "PGDMP";
const mask = (k: string, v: unknown) => ((SECRET_SETTING_KEYS as readonly string[]).includes(k) ? "***" : v);

/** "2026-10-14T00:00:00+07:00" -> "20261014-000000" */
const stamp = (db: Db) => nowIso(db).slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

function addBackup(db: Db, name: string, sizeBytes: number): BackupFile {
  const file: BackupFile = {
    name, sizeBytes, createdAt: nowIso(db),
    copiedToShare: db.settings.backup_share_enabled && db.settings.backup_share_path !== "",
  };
  db.backups.push(file);
  return file;
}

export const systemHandlers = [
  http.get(p(ENDPOINTS.systemStatus), handle(({ db }) => ({
    maintenance: db.maintenance,
    message: db.maintenance ? ERROR_MESSAGES.MAINTENANCE : null,
  }), { duringMaintenance: true })),

  http.get(p(ENDPOINTS.settings), handle((ctx) => (superAdmin(ctx), toSettingsView(ctx.db.settings)))),
  /** Spec 5.12: partial update, applies immediately; audit shows only changed keys, secrets as ***. */
  http.put(p(ENDPOINTS.settings), handle(async (ctx) => {
    const u = superAdmin(ctx);
    const input = await parseBody(ctx.request, SettingsUpdate);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input) as [keyof Settings, unknown][]) {
      if (v === undefined || ctx.db.settings[k] === v) continue;
      before[k] = ctx.db.settings[k] === "" ? "" : mask(k, ctx.db.settings[k]);
      after[k] = mask(k, v);
    }
    ctx.db.settings = { ...ctx.db.settings, ...input };
    if (Object.keys(after).length) audit(ctx.db, u.id, "SETTINGS_UPDATE", "settings", "-", before, after);
    return toSettingsView(ctx.db.settings);
  })),
  // ponytail: no real FCM / SMB; checks only that the needed settings are filled.
  http.post(p(ENDPOINTS.settingsTestPush), handle((ctx) => {
    superAdmin(ctx);
    const s = ctx.db.settings;
    if (!s.push_enabled) return { ok: false, message: "Push notifikasi belum diaktifkan." };
    if (!s.fcm_service_account) return { ok: false, message: "Service account FCM belum diisi." };
    return { ok: true, message: "Notifikasi uji terkirim ke perangkat kamu." };
  })),
  http.post(p(ENDPOINTS.settingsTestShare), handle((ctx) => {
    superAdmin(ctx);
    const s = ctx.db.settings;
    if (!s.backup_share_path) return { ok: false, message: "Path network share belum diisi." };
    return { ok: true, message: `Berhasil menulis file uji ke ${s.backup_share_path}.` };
  })),

  http.get(p(ENDPOINTS.backups), handle((ctx) => {
    superAdmin(ctx);
    return [...ctx.db.backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  })),
  http.post(p(ENDPOINTS.backupRun), handle((ctx) => {
    const u = superAdmin(ctx);
    const file = addBackup(ctx.db, `bms-${stamp(ctx.db)}.dump`, 1_048_576 + ctx.db.bookings.length * 128);
    audit(ctx.db, u.id, "BACKUP_RUN", "backup", file.name, null, file);
    return file;
  })),
  // Literal path: ENDPOINTS.backupDownload(":name") would encode the colon.
  http.get(p("/api/backups/:name/download"), handle((ctx) => {
    superAdmin(ctx);
    const file = ctx.db.backups.find((b) => b.name === ctx.params.name);
    if (!file) throw new DomainError("NOT_FOUND");
    return new Response(new TextEncoder().encode(`${MAGIC}${file.name}`), {
      headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${file.name}"` },
    });
  })),
  /** Spec 5.11 step 2: a file that is not a pg_dump custom archive is rejected before it is listed. */
  http.post(p(ENDPOINTS.backupUpload), handle(async (ctx) => {
    const u = superAdmin(ctx);
    const form = await ctx.request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new DomainError("VALIDATION_ERROR", "File backup wajib diunggah.");
    if (!file.name.endsWith(".dump")) throw new DomainError("VALIDATION_ERROR", "File backup harus berekstensi .dump.");
    const head = new TextDecoder().decode((await file.arrayBuffer()).slice(0, MAGIC.length));
    if (head !== MAGIC) throw new DomainError("VALIDATION_ERROR", "File bukan backup database yang valid.");
    if (ctx.db.backups.some((b) => b.name === file.name)) throw new DomainError("VALIDATION_ERROR", `File ${file.name} sudah ada.`);
    const row = addBackup(ctx.db, file.name, file.size);
    row.copiedToShare = false;
    audit(ctx.db, u.id, "BACKUP_UPLOAD", "backup", row.name, null, row);
    return row;
  })),
  /** Spec 5.11 restore, steps in the order the backend must keep. */
  http.post(p(ENDPOINTS.restore), handle(async (ctx) => {
    const u = superAdmin(ctx);
    const input = await parseBody(ctx.request, RestoreRequest);
    if (input.password !== u.password) throw new DomainError("VALIDATION_ERROR", "Password salah.");
    if (!input.fileName.endsWith(".dump") || !ctx.db.backups.some((b) => b.name === input.fileName)) throw new DomainError("NOT_FOUND", "File backup tidak ditemukan.");
    const preRestore = addBackup(ctx.db, `pre-restore-${stamp(ctx.db)}.dump`, 1_048_576 + ctx.db.bookings.length * 128);
    // ponytail: in-memory data stays as is; the backend runs pg_restore under the maintenance flag here.
    ctx.db.sessions.clear();
    audit(ctx.db, u.id, "BACKUP_RESTORE", "backup", input.fileName, null, { preRestore: preRestore.name });
    return { preRestore };
  })),
];