import { useState, type FormEvent } from "react";
import { SetupRequest, type Me } from "@bms/shared";
import { setupFirstAdmin } from "../api";
import { ErrorText, useAction } from "../ui";

/** Spec 6.1 first run: only reachable while the server says needsSetup. */
export function Setup({ onDone }: { onDone(me: Me): void }) {
  const [form, setForm] = useState({ nik: "", name: "", password: "" });
  const { busy, error, run } = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const me = await run(() => setupFirstAdmin(SetupRequest.parse(form)));
    if (me) onDone(me);
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <h1>Setup Awal</h1>
        <p>Buat akun Super Admin pertama.</p>
        <label>NIK<input value={form.nik} onChange={set("nik")} required /></label>
        <label>Nama<input value={form.name} onChange={set("name")} required /></label>
        <label>Password<input type="password" value={form.password} onChange={set("password")} minLength={8} required /></label>
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>Buat Super Admin</button>
      </form>
    </div>
  );
}
