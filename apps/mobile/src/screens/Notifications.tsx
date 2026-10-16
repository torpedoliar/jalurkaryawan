import { Button, Text, View } from "react-native";
import { z } from "zod";
import { ENDPOINTS, Notification } from "@bms/shared";
import { api } from "../api";
import { ErrorText, useAction, useLoad } from "../ui";

export function Notifications() {
  const list = useLoad(() => api.get(ENDPOINTS.notifications, z.array(Notification)), []);
  const { busy, error, run } = useAction();
  async function markRead(id: string) {
    if (await run(async () => { await api.post(ENDPOINTS.notificationRead(id), z.void()); return true; })) list.reload();
  }
  return (
    <View>
      <Text accessibilityRole="header">Notifikasi</Text>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <Text>Belum ada notifikasi.</Text>}
      {list.data?.map((n) => (
        <View key={n.id} accessible accessibilityRole="summary">
          <Text style={{ fontWeight: "700" }}>{n.title}</Text>
          <Text>{n.body}</Text>
          <Text>{n.createdAt.slice(0, 16).replace("T", " ")}</Text>
          {n.readAt ? <Text>Dibaca</Text> : <Button title="Tandai dibaca" onPress={() => void markRead(n.id)} disabled={busy} />}
        </View>
      ))}
    </View>
  );
}
