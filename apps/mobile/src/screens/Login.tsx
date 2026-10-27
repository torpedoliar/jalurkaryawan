import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { login } from "../api";
import { useAuth } from "../auth";
import { Btn, C, ErrorText, F, S, useAction } from "../ui";

export function Login() {
  const { setMe } = useAuth();
  const [nik, setNik] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  async function submit() {
    const me = await run(() => login(nik.trim(), password));
    if (me) setMe(me);
  }
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 16, gap: 16, backgroundColor: C.bg }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: F.black, fontSize: 34, color: C.ink }}>Jalur <Text style={{ backgroundColor: C.signal, color: C.signalInk }}> Karyawan </Text></Text>
        <Text accessibilityRole="header" style={S.eyebrow}>Bus Karyawan</Text>
        <Text style={{ fontFamily: F.black, fontSize: 20, color: C.ink, marginTop: 6 }}>Perjalanan Nyaman, Kerja Tenang.</Text>
        <Text style={S.text}>JALUR — Jemput Antar Layanan untuk Rutinitas Karyawan</Text>
      </View>
      <View style={[S.card, { gap: 10 }]}>
        <Text style={S.eyebrow}>NIK</Text>
        <TextInput value={nik} onChangeText={setNik} autoCapitalize="none" accessibilityLabel="NIK" style={S.input} />
        <Text style={S.eyebrow}>Password</Text>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry accessibilityLabel="Password" style={S.input} />
        <ErrorText error={error} />
        <Btn primary title={busy ? "Memuat..." : "Masuk"} onPress={() => void submit()} disabled={busy} />
      </View>
    </View>
  );
}
