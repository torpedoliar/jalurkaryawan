import { useEffect } from "react";
import { Text, View } from "react-native";
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
    <View>
      <Text accessibilityRole="header">Sistem sedang dalam pemeliharaan</Text>
      <Text>Sistem sedang memulihkan database. Halaman akan kembali otomatis.</Text>
    </View>
  );
}
