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
    <div className="center">
      <form className="card" onSubmit={submit}>
        <h1>Bus Karyawan</h1>
        <label>NIK<input value={nik} onChange={(e) => setNik(e.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>Masuk</button>
      </form>
    </div>
  );
}
