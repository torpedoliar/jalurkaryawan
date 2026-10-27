import { useState, type FormEvent } from "react";
import { login } from "../api";
import { useAuth } from "../auth";
import { ErrorText, useAction } from "../ui";

export function Login() {
  const { setMe } = useAuth();
  const [nik, setNik] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const me = await run(() => login(nik.trim(), password));
    if (me) setMe(me);
  }
  return (
    <div className="login-screen">
      <div className="login-bg" aria-hidden="true" />
      <div className="login-shade" aria-hidden="true" />
      <main className="login-main">
        <div className="login-brand">Jalur <span>Karyawan</span></div>
        <div className="login-pitch">
          <span className="eyebrow">Jemput Antar Layanan untuk Rutinitas Karyawan</span>
          <h1>Perjalanan <em>Nyaman</em>, Kerja <em>Tenang.</em></h1>
          <blockquote className="login-quote">
            <p><b>JALUR</b> — <b>J</b>emput <b>A</b>ntar <b>L</b>ayanan untuk <b>R</b>utinitas Karyawan.</p>
          </blockquote>
          <p>Pesan kursi, lihat armada, dan pantau keberangkatan dalam satu tempat.</p>
        </div>
        <form className="login-card" onSubmit={submit}>
          <span className="eyebrow">Masuk akun</span>
          <h2>Bus Karyawan</h2>
          <p>Gunakan NIK dan password yang diberikan Admin GA.</p>
          <label>NIK<input value={nik} onChange={(e) => setNik(e.target.value)} autoComplete="username" required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <ErrorText error={error} />
          <button className="primary" disabled={busy}>Masuk</button>
          <small className="login-note">Lupa password atau akun terkunci? Hubungi Admin GA untuk reset.</small>
        </form>
        <small className="login-foot">Jalur Karyawan · sistem internal PT. Santos Jaya Abadi</small>
      </main>
      <aside className="login-side" aria-hidden="true">
        <span className="login-side-pin" />
        <span className="login-side-line" />
        <span className="login-side-pin end" />
      </aside>
    </div>
  );
}
