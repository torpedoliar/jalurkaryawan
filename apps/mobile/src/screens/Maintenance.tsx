import { useEffect } from "react";
import { Text, View } from "react-native";
import { ENDPOINTS, SystemStatus } from "@bms/shared";
import { api } from "../api";
import { C, S } from "../ui";

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
    <View style={{ flex: 1, justifyContent: "center", padding: 16, gap: 10, backgroundColor: C.bg }}>
      <Text accessibilityRole="header" style={[S.title, { fontSize: 26 }]}>Sistem sedang dalam pemeliharaan</Text>
      <Text style={S.text}>Sistem sedang memulihkan database. Halaman akan kembali otomatis.</Text>
    </View>
  );
}
