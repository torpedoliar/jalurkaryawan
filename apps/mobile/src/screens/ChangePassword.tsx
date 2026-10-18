import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { z } from "zod";
import { ChangePasswordRequest, ENDPOINTS, Me } from "@bms/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { Btn, C, ErrorText, S, Title, useAction } from "../ui";

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
    // Forced mode renders without the tab shell, so it brings its own page padding.
    <View style={[S.screen, forced && { flex: 1, justifyContent: "center", padding: 16, backgroundColor: C.bg }]}>
      <Title kicker="Akun">Ganti Password</Title>
      {forced && <Text style={S.text}>Kamu wajib mengganti password sebelum melanjutkan.</Text>}
      <View style={S.card}>
      <Text style={S.eyebrow}>Password lama</Text>
      <TextInput value={form.current} onChangeText={(v) => setForm({ ...form, current: v })} secureTextEntry accessibilityLabel="Password lama" style={S.input} />
      <Text style={S.eyebrow}>Password baru</Text>
      <TextInput value={form.next} onChangeText={(v) => setForm({ ...form, next: v })} secureTextEntry accessibilityLabel="Password baru" style={S.input} />
      <Text style={S.eyebrow}>Ulangi password baru</Text>
      <TextInput value={form.again} onChangeText={(v) => setForm({ ...form, again: v })} secureTextEntry accessibilityLabel="Ulangi password baru" style={S.input} />
      <ErrorText error={error} />
      {done && <Text accessibilityLiveRegion="polite" style={S.text}>Password berhasil diganti.</Text>}
      <Btn primary title={busy ? "Menyimpan..." : "Simpan"} onPress={() => void submit()} disabled={busy} />
      </View>
    </View>
  );
}
