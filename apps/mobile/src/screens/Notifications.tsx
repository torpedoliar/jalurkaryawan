import { Text, View } from "react-native";
import { z } from "zod";
import { ENDPOINTS, Notification } from "@bms/shared";
import { api } from "../api";
import { Btn, C, ErrorText, F, S, Title, useAction, useLoad } from "../ui";

export function Notifications() {
  const list = useLoad(() => api.get(ENDPOINTS.notifications, z.array(Notification)), []);
  const { busy, error, run } = useAction();
  async function markRead(id: string) {
    if (await run(async () => { await api.post(ENDPOINTS.notificationRead(id), z.void()); return true; })) list.reload();
  }
  return (
    <View style={S.screen}>
      <Title kicker="Pesan">Notifikasi</Title>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <Text style={S.text}>Belum ada notifikasi.</Text>}
      {list.data?.map((n) => (
        <View key={n.id} testID="notification-card" style={[S.card, !n.readAt && { borderLeftWidth: 4, borderLeftColor: C.signal }]}>
          <Text style={S.eyebrow}>{n.createdAt.slice(0, 16).replace("T", " ")}</Text>
          <Text style={[S.text, { fontFamily: F.bodyBold }]}>{n.title}</Text>
          <Text style={S.text}>{n.body}</Text>
          {n.readAt ? <Text style={S.eyebrow}>Dibaca</Text> : <Btn title="Tandai dibaca" onPress={() => void markRead(n.id)} disabled={busy} />}
        </View>
      ))}
    </View>
  );
}
