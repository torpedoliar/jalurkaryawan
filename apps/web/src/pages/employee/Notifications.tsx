import { z } from "zod";
import { ENDPOINTS, Notification } from "@bms/shared";
import { api } from "../../api";
import { ErrorText, useAction, useLoad } from "../../ui";

export function Notifications() {
  const list = useLoad(() => api.get(ENDPOINTS.notifications, z.array(Notification)), []);
  const { busy, error, run } = useAction();
  async function markRead(id: string) {
    if (await run(async () => { await api.post(ENDPOINTS.notificationRead(id), z.void()); return true; })) list.reload();
  }
  return (
    <section className="card">
      <h1>Notifikasi</h1>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <p>Belum ada notifikasi.</p>}
      {list.data?.map((n) => (
        <article key={n.id} className="card">
          <strong>{n.title}</strong>
          <p>{n.body}</p>
          <small>{n.createdAt.slice(0, 16).replace("T", " ")}</small>{" "}
          {n.readAt ? <small>Dibaca</small> : <button disabled={busy} onClick={() => void markRead(n.id)}>Tandai dibaca</button>}
        </article>
      ))}
    </section>
  );
}
