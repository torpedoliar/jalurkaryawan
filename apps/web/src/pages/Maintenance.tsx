import { useEffect } from "react";
import { ENDPOINTS, SystemStatus } from "@bms/shared";
import { api } from "../api";

const POLL_MS = 2000;

/** Spec 5.11: shown while a restore runs; polls until the server is back. */
export function Maintenance({ onDone }: { onDone(): void }) {
  useEffect(() => {
    const id = setInterval(() => {
      api.get(ENDPOINTS.systemStatus, SystemStatus).then((s) => { if (!s.maintenance) onDone(); }, () => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [onDone]);
  return (
    <div className="maint-layout">
      <div className="card maint-card">
        <div className="maint-icon" aria-hidden="true">↻</div>
        <h1>Sistem sedang dalam pemeliharaan</h1>
        <p>Sistem sedang memulihkan database. Halaman akan kembali otomatis.</p>
        <p className="count">Memeriksa status setiap 2 detik · jangan tutup halaman ini</p>
      </div>
    </div>
  );
}
