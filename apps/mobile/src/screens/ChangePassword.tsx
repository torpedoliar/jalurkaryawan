import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { ChangePasswordRequest, ENDPOINTS, Me } from "@bms/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorText, useAction } from "../ui";

export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { setMe } = useAuth();
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();
  async function submit() {
    if (form.next !== form.again) return setError("Konfirmasi password tidak sama.");
    const me = await run(async () => {
      await api.post(ENDPOINTS.changePassword, z.void(), ChangePasswordRequest.parse({ currentPassword: form.current, newPassword: form.next }));
      return api.get(ENDPOINTS.me, Me);
    });
    if (!me) return;
    setForm({ current: "", next: "", again: "" });
    setDone(true);
    setMe(me);
  }
  return (
    <View>
      <Text accessibilityRole="header">Ganti Password</Text>
      {forced && <Text>Kamu wajib mengganti password sebelum melanjutkan.</Text>}
      <Text>Password lama</Text>
      <TextInput value={form.current} onChangeText={(v) => setForm({ ...form, current: v })} secureTextEntry accessibilityLabel="Password lama" />
      <Text>Password baru</Text>
      <TextInput value={form.next} onChangeText={(v) => setForm({ ...form, next: v })} secureTextEntry accessibilityLabel="Password baru" />
      <Text>Ulangi password baru</Text>
      <TextInput value={form.again} onChangeText={(v) => setForm({ ...form, again: v })} secureTextEntry accessibilityLabel="Ulangi password baru" />
      <ErrorText error={error} />
      {done && <Text accessibilityLiveRegion="polite">Password berhasil diganti.</Text>}
      <Button title={busy ? "Menyimpan..." : "Simpan"} onPress={() => void submit()} disabled={busy} />
    </View>
  );
}
