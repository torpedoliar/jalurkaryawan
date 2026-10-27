import { useState } from "react";
import { z } from "zod";
import { ENDPOINTS, Notification } from "@bms/shared";
import { api } from "../../api";
import { ErrorText, PageHeader, Stat, StatGrid, useAction, useLoad } from "../../ui";

const TYPE_LABEL: Record<string, string> = {
  TRIP_CANCELLED: "Trip dibatalkan", BUS_CHANGED: "Bus diganti", SCHEDULE_CHANGED: "Jadwal berubah",
  BOOKING_CANCELLED: "Booking dibatalkan", SUBSCRIPTION_REJECTED: "Langganan ditolak", SUSPENDED: "Pembekuan",
  UNSUSPENDED: "Pembekuan dicabut", REMINDER: "Pengingat",
};

export function Notifications() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useLoad(() => api.get(ENDPOINTS.notifications, z.array(Notification)), []);
  const { busy, error, run } = useAction();
  const rows = (list.data ?? []).filter((n) => !unreadOnly || !n.readAt);
  const unread = list.data?.filter((n) => !n.readAt).length ?? 0;
  async function markRead(id: string) {
    if (await run(async () => { await api.post(ENDPOINTS.notificationRead(id), z.void()); return true; })) list.reload();
  }
  return (
    <>
      <PageHeader title="Notifikasi" eyebrow="Pantauan" description="Pengingat perjalanan dan pemberitahuan perubahan trip. Baca yang belum dibaca agar tidak terlewat." />
      <ErrorText error={error ?? list.error} />
      {list.data && (
        <StatGrid cols={3}>
          <Stat label="Belum dibaca" value={unread} hint="perlu perhatian" tone={unread ? "warn" : "ok"} />
          <Stat label="Total notifikasi" value={list.data.length} hint="tersimpan di kotak masuk" />
          <Stat label="Sudah dibaca" value={list.data.length - unread} hint="riwayat pemberitahuan" tone="ok" />
        </StatGrid>
      )}
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Saring notifikasi">
          <button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Semua</button>
          <button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Belum dibaca</button>
        </div>
        <p className="count">{rows.length} notifikasi</p>
      </div>
      {list.data?.length === 0 && <p className="empty-note">Belum ada notifikasi.</p>}
      {list.data && list.data.length > 0 && rows.length === 0 && <p className="empty-note">Tidak ada notifikasi yang belum dibaca.</p>}
      <div className="notes">
        {rows.map((n) => (
          <article key={n.id} className={n.readAt ? "note" : "note unread"}>
            <div className="note-icon" aria-hidden="true">{n.readAt ? "✓" : "!"}</div>
            <div className="note-body">
              <div className="note-head"><strong>{n.title}</strong><span className="tag">{TYPE_LABEL[n.type] ?? n.type}</span></div>
              <p>{n.body}</p>
              <small className="count">{n.createdAt.slice(0, 16).replace("T", " ")}</small>
            </div>
            {n.readAt ? <small className="count">Dibaca</small> : <button disabled={busy} onClick={() => void markRead(n.id)}>Tandai dibaca</button>}
          </article>
        ))}
      </div>
    </>
  );
}
