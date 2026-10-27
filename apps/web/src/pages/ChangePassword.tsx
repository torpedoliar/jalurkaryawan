import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ChangePasswordRequest, ENDPOINTS, Me } from "@bms/shared";
import { api } from "../api";
import { useAuth, useMe } from "../auth";
import { ErrorText, PageHeader, Panel, useAction } from "../ui";

export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { setMe } = useAuth();
  const me = useMe();
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();
  const field = (k: keyof typeof form, label: string, auto: string) => (
    <label>{label}<input type="password" autoComplete={auto} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required /></label>
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.next !== form.again) return setError("Konfirmasi password tidak sama.");
    const updated = await run(async () => {
      await api.post(ENDPOINTS.changePassword, z.void(), ChangePasswordRequest.parse({ currentPassword: form.current, newPassword: form.next }));
      return api.get(ENDPOINTS.me, Me);
    });
    if (!updated) return;
    setForm({ current: "", next: "", again: "" });
    setDone(true);
    setMe(updated); // forced mode: mustChangePassword is now false, App swaps to the normal routes
  }
  const formCard = (
    <form className={forced ? "card narrow" : "stack"} onSubmit={submit}>
      {forced && <><span className="eyebrow">Wajib sebelum lanjut</span><h1>Ganti Password</h1></>}
      {forced && <p>Kamu wajib mengganti password sebelum melanjutkan.</p>}
      {field("current", "Password lama", "current-password")}
      {field("next", "Password baru", "new-password")}
      {field("again", "Ulangi password baru", "new-password")}
      <ErrorText error={error} />
      {done && <p role="status" className="result-card">Password berhasil diganti.</p>}
      <button className="primary" disabled={busy}>Simpan</button>
    </form>
  );
  if (forced) return <div className="center">{formCard}</div>;
  return (
    <>
      <PageHeader title="Ganti Password" eyebrow="Akun" description="Gunakan password yang belum pernah dipakai di tempat lain. Sesi lain tetap aktif sampai keluar." />
      <div className="pw-layout">
        <Panel title="Password baru" description="Masukkan password lama untuk mengonfirmasi perubahan.">{formCard}</Panel>
        <div className="stack">
          <Panel title="Akun">
            <div className="who" style={{ background: "transparent", padding: 0 }}>
              <span className="avatar" aria-hidden="true">{me.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{me.name}</strong><span className="eyebrow">{me.nik}</span></div>
            </div>
          </Panel>
          <Panel title="Panduan password">
            <ul className="pw-rules">
              <li>Minimal 8 karakter atau sesuai kebijakan admin.</li>
              <li>Jangan gunakan NIK, nama, atau tanggal lahir.</li>
              <li>Konfirmasi harus sama dengan password baru.</li>
              <li>Ganti segera jika password pernah dibagikan.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
