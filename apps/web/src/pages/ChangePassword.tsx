import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ChangePasswordRequest, ENDPOINTS, Me } from "@bms/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorText, useAction } from "../ui";

export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { setMe } = useAuth();
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();
  const field = (k: keyof typeof form, label: string, auto: string) => (
    <label>{label}<input type="password" autoComplete={auto} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required /></label>
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.next !== form.again) return setError("Konfirmasi password tidak sama.");
    const me = await run(async () => {
      await api.post(ENDPOINTS.changePassword, z.void(), ChangePasswordRequest.parse({ currentPassword: form.current, newPassword: form.next }));
      return api.get(ENDPOINTS.me, Me);
    });
    if (!me) return;
    setForm({ current: "", next: "", again: "" });
    setDone(true);
    setMe(me); // forced mode: mustChangePassword is now false, App swaps to the normal routes
  }
  const card = (
    <form className="card" onSubmit={submit}>
      <h1>Ganti Password</h1>
      {forced && <p>Kamu wajib mengganti password sebelum melanjutkan.</p>}
      {field("current", "Password lama", "current-password")}
      {field("next", "Password baru", "new-password")}
      {field("again", "Ulangi password baru", "new-password")}
      <ErrorText error={error} />
      {done && <p role="status">Password berhasil diganti.</p>}
      <button className="primary" disabled={busy}>Simpan</button>
    </form>
  );
  return forced ? <div className="center">{card}</div> : card;
}
