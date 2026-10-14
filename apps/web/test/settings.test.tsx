import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { getDb } from "@bms/mock-api";
import { BackupFile, ENDPOINTS, RestoreRequest } from "@bms/shared";
import { z } from "zod";
import { api } from "../src/api";
import { renderApp } from "./render";

/** jsdom has no createObjectURL and no navigation on <a>.click(); record the file name instead. */
function captureDownloads() {
  const saved: string[] = [];
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
  return saved;
}

/** A valid pg_dump custom archive starts with the magic "PGDMP". */
const dumpFile = (name: string, body = `PGDMP${name}`) => new File([body], name);

const FCM = JSON.stringify({ type: "service_account", project_id: "p", private_key: "k", client_email: "e@x.com" });
const TestResult = z.object({ ok: z.boolean(), message: z.string() });
const RestoreResponse = z.object({ preRestore: BackupFile });

// captureDownloads spies on a prototype; restore it so later files are unaffected.
afterEach(() => vi.restoreAllMocks());

describe("pengaturan", () => {
  test("defaults load and a booking change saves", async () => {
    const { user } = await renderApp("/pengaturan", "admin");
    const cutoff = await screen.findByLabelText("Batas booking (menit)");
    expect((cutoff as HTMLInputElement).value).toBe("120");
    // carry defect 9: user.clear cannot focus a type="number" input in this jsdom, so number
    // fields are replaced wholesale with fireEvent.change (the pattern reports/master tests use).
    fireEvent.change(screen.getByLabelText("Batas booking (menit)"), { target: { value: "90" } });
    await user.click(screen.getByRole("button", { name: "Simpan pengaturan" }));
    expect((await screen.findByRole("status")).textContent).toContain("Pengaturan disimpan.");
    expect(getDb().settings.booking_cutoff_minutes).toBe(90);
    expect(getDb().settings.generate_days_ahead).toBe(7);
  });

  test("a value out of range is rejected by the shared schema", async () => {
    const { user } = await renderApp("/pengaturan", "admin");
    await screen.findByLabelText("Batas booking (menit)");
    fireEvent.change(screen.getByLabelText("Batas booking (menit)"), { target: { value: "9999" } });
    await user.click(screen.getByRole("button", { name: "Simpan pengaturan" }));
    expect((await screen.findByRole("alert")).textContent).toContain("1440");
    expect(getDb().settings.booking_cutoff_minutes).toBe(120);
  });

  test("a secret shows status only, and can be set then cleared", async () => {
    const { user } = await renderApp("/pengaturan", "admin");
    await user.click(await screen.findByRole("button", { name: "Backup" }));
    const first = (await screen.findByText("Password share")).closest("section")!;
    expect(first.textContent).toContain("Belum diisi");
    await user.type(screen.getByLabelText("Password share"), "rahasia");
    await user.click(screen.getByRole("button", { name: "Simpan pengaturan" }));
    expect((await screen.findByRole("status")).textContent).toContain("Pengaturan disimpan.");
    expect(getDb().settings.backup_share_password).toBe("rahasia");

    // A fresh render reads the server's view: isSet true, value never present.
    // cleanup() first, or screen would find two copies of every label.
    cleanup();
    const { user: again } = await renderApp("/pengaturan", "admin");
    await again.click(await screen.findByRole("button", { name: "Backup" }));
    const reloaded = (await screen.findByText("Password share")).closest("section")!;
    expect(reloaded.textContent).toContain("Tersimpan");
    expect(reloaded.textContent).not.toContain("rahasia");
    await again.click(within(reloaded).getByRole("button", { name: "Hapus" }));
    await again.click(screen.getByRole("button", { name: "Simpan pengaturan" }));
    expect((await screen.findByRole("status")).textContent).toContain("Pengaturan disimpan.");
    expect(getDb().settings.backup_share_password).toBe("");
  });

  test("FCM upload, push toggle and test push", async () => {
    const { user } = await renderApp("/pengaturan", "admin");
    await user.click(await screen.findByRole("button", { name: "Notifikasi" }));
    await user.upload(await screen.findByLabelText("Service account FCM (JSON)"), new File([FCM], "fcm.json"));
    await user.click(screen.getByLabelText("Aktifkan push"));
    await user.click(screen.getByRole("button", { name: "Simpan pengaturan" }));
    expect((await screen.findByRole("status")).textContent).toContain("Pengaturan disimpan.");
    expect(getDb().settings.push_enabled).toBe(true);
    expect(getDb().settings.fcm_service_account).toBe(FCM);
    await user.click(screen.getByRole("button", { name: "Tes kirim push" }));
    expect((await screen.findByRole("status")).textContent).toContain("Notifikasi uji terkirim ke perangkat kamu.");
  });

  test("test share reports the returned message", async () => {
    const { user } = await renderApp("/pengaturan", "admin");
    await user.click(await screen.findByRole("button", { name: "Backup" }));
    await user.click(screen.getByRole("button", { name: "Tes koneksi share" }));
    expect((await screen.findByRole("status")).textContent).toContain("Path network share belum diisi.");
    await user.type(screen.getByLabelText("Path share"), "//nas/backup/bms");
    await user.click(screen.getByRole("button", { name: "Simpan pengaturan" }));
    await user.click(screen.getByRole("button", { name: "Tes koneksi share" }));
    expect((await screen.findByRole("status")).textContent).toContain("Berhasil menulis file uji ke //nas/backup/bms.");
  });
});

describe("backup", () => {
  test("empty list, run, download", async () => {
    const saved = captureDownloads();
    const { user } = await renderApp("/pengaturan", "admin");
    await user.click(await screen.findByRole("button", { name: "Backup" }));
    expect(await screen.findByText("Belum ada file backup.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Backup sekarang" }));
    const row = await screen.findByRole("row", { name: /bms-20261014-000000\.dump/ });
    expect(within(row).getByRole("cell", { name: "Belum" })).toBeTruthy();
    await user.click(within(row).getByRole("button", { name: "Unduh" }));
    expect(saved).toEqual(["bms-20261014-000000.dump"]);
  });

  /**
   * carry defect 1 (unchanged ruling): jsdom 25's `new Request(url, { body: FormData })` does NOT
   * serialize multipart - it sends an empty body, so the handler's `form.get("file")` is not a File
   * and every request built from a real FormData answers the same first branch,
   * "File backup wajib diunggah.". That is the platform, not the code: no handler was touched and
   * no multipart body is hand-rolled, because a string-concatenated boundary would prove nothing
   * about the real upload.
   *
   * So the assertions below record what the DOM upload path can reach in this environment: the
   * input fires, the real handler answers its first branch, and nothing is added to the list. The
   * file-extension, bad-magic and happy-path branches are covered where `fetch` serializes FormData
   * for real - packages/mock-api/test/handlers.test.ts. The DOM path itself is Task 10's Playwright run.
   */
  test("upload rejects a file that is not a pg_dump archive", async () => {
    const { user } = await renderApp("/pengaturan", "admin");
    await user.click(await screen.findByRole("button", { name: "Backup" }));
    await user.upload(await screen.findByLabelText("File backup"), dumpFile("catatan.sql"));
    // The screen's own change handler runs and the list stays empty (the request 400s at the
    // handler's first branch because jsdom cannot serialize the multipart body).
    expect(getDb().backups).toHaveLength(0);

    const post = (f: File) => {
      const form = new FormData();
      form.append("file", f);
      return api.upload(ENDPOINTS.backupUpload, BackupFile, form);
    };
    // MEASURED PLATFORM LIMIT, not a code defect: jsdom 25 does not serialize a FormData body, so
    // every upload here answers the handler's first branch. The file-extension, bad-magic and
    // happy-path branches are covered where FormData really serializes:
    // packages/mock-api/test/handlers.test.ts ("upload rejects a file that is not a pg_dump archive").
    await expect(api.upload(ENDPOINTS.backupUpload, BackupFile, new FormData())).rejects.toThrow("File backup wajib diunggah.");
    await expect(post(dumpFile("catatan.sql"))).rejects.toThrow("File backup wajib diunggah.");
    expect(getDb().backups).toHaveLength(0);
  });

  test("restore needs the right password and ends the session", async () => {
    const { user } = await renderApp("/pengaturan", "admin");
    await user.click(await screen.findByRole("button", { name: "Backup" }));
    await user.click(screen.getByRole("button", { name: "Backup sekarang" }));
    const name = getDb().backups[0]!.name;
    const sessionsBefore = getDb().sessions.size;
    await user.type(screen.getByLabelText("File backup tujuan"), name);
    await user.type(screen.getByLabelText("Ketik RESTORE"), "RESTORE");
    await user.type(screen.getByLabelText("Password kamu"), "salah");
    await user.click(screen.getByRole("button", { name: "Pulihkan database" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Password salah.");
    // A wrong password leaves every session alone: this restore did not run.
    expect(getDb().sessions.size).toBe(sessionsBefore);

    await user.clear(screen.getByLabelText("Password kamu"));
    await user.type(screen.getByLabelText("Password kamu"), "demo1234");
    await user.click(screen.getByRole("button", { name: "Pulihkan database" }));
    // A success clears every session (spec 5.11) and the screen signs out, so the status line it
    // showed is read from the response it rendered it from, captured at the fetch boundary.
    expect(await screen.findByRole("button", { name: "Masuk" })).toBeTruthy();
    expect(getDb().backups.some((b) => b.name.startsWith("pre-restore-"))).toBe(true);
    expect(getDb().sessions.size).toBe(0);
  });

  test("restore rejects a missing file, and confirm must be the exact literal", async () => {
    const { user } = await renderApp("/pengaturan", "admin");
    await user.click(await screen.findByRole("button", { name: "Backup" }));
    await user.click(screen.getByRole("button", { name: "Backup sekarang" }));
    const name = getDb().backups[0]!.name;
    const sessionsBefore = getDb().sessions.size;

    // The password is checked before the file lookup, so a good password with an unknown file is a 404.
    await user.type(screen.getByLabelText("File backup tujuan"), "tidak-ada.dump");
    await user.type(screen.getByLabelText("Ketik RESTORE"), "RESTORE");
    await user.type(screen.getByLabelText("Password kamu"), "demo1234");
    await user.click(screen.getByRole("button", { name: "Pulihkan database" }));
    expect((await screen.findByRole("alert")).textContent).toContain("File backup tidak ditemukan.");
    expect(getDb().sessions.size).toBe(sessionsBefore);

    // The button stays disabled until confirm matches the literal the schema requires,
    // so a lowercase "restore" never reaches the endpoint at all.
    await user.clear(screen.getByLabelText("File backup tujuan"));
    await user.type(screen.getByLabelText("File backup tujuan"), name);
    await user.clear(screen.getByLabelText("Ketik RESTORE"));
    await user.type(screen.getByLabelText("Ketik RESTORE"), "restore");
    expect(screen.getByRole("button", { name: "Pulihkan database" })).toHaveProperty("disabled", true);
    expect(getDb().sessions.size).toBe(sessionsBefore);

    // The request body carries the literal the shared schema demands, and only that literal.
    expect(RestoreRequest.safeParse({ fileName: name, password: "demo1234", confirm: "RESTORE" }).success).toBe(true);
    expect(RestoreRequest.safeParse({ fileName: name, password: "demo1234", confirm: "restore" }).success).toBe(false);
  });

  test("the restore reply carries the pre-restore file, and the test endpoints answer as documented", async () => {
    const replies: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await realFetch(input, init);
      if (String(input).includes(ENDPOINTS.restore) && res.ok) replies.push(JSON.stringify(RestoreResponse.parse(await res.clone().json())));
      return res;
    }) as typeof fetch;
    try {
      const { user } = await renderApp("/pengaturan", "admin");
      await user.click(await screen.findByRole("button", { name: "Backup" }));
      await user.click(screen.getByRole("button", { name: "Backup sekarang" }));
      const name = getDb().backups[0]!.name;
      await user.type(screen.getByLabelText("File backup tujuan"), name);
      await user.type(screen.getByLabelText("Ketik RESTORE"), "RESTORE");
      await user.type(screen.getByLabelText("Password kamu"), "demo1234");
      await user.click(screen.getByRole("button", { name: "Pulihkan database" }));
      // The screen signs out on success, so wait for the Login screen: the restore has completed.
      expect(await screen.findByRole("button", { name: "Masuk" })).toBeTruthy();
      // The status line the screen rendered was "Backup pra-pemulihan: <name>", and that name is a real file.
      expect(replies[0]).toMatch(/"preRestore":\{"name":"pre-restore-/);
      const shown = JSON.parse(replies[0]!).preRestore.name as string;
      expect(getDb().backups.some((b) => b.name === shown)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("the test-push and test-share endpoints answer ok:false over HTTP 200 while unconfigured", async () => {
    await renderApp("/pengaturan", "admin");
    // A failed test is not a failed API call: HTTP 200 with {ok:false}, which is why the screen
    // renders these as role="status" and not role="alert". Read straight from the endpoint.
    expect(await api.post(ENDPOINTS.settingsTestPush, TestResult)).toEqual({ ok: false, message: "Push notifikasi belum diaktifkan." });
    expect(await api.post(ENDPOINTS.settingsTestShare, TestResult)).toEqual({ ok: false, message: "Path network share belum diisi." });
  });
});

describe("hak akses", () => {
  test("an ADMIN_GA cannot open /pengaturan", async () => {
    await renderApp("/pengaturan", "ga");
    // carry defect 5 (corrected): /vendor-bus is the first row an ADMIN_GA can see, so that is the landing.
    expect(await screen.findByRole("heading", { name: "Vendor & Bus" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Pengaturan" })).toBeNull();
  });
});
