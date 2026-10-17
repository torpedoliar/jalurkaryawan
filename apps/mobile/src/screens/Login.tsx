import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { login } from "../api";
import { useAuth } from "../auth";
import { ErrorText, useAction } from "../ui";

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
    <View>
      <Text accessibilityRole="header">Bus Karyawan</Text>
      <Text>NIK</Text>
      <TextInput value={nik} onChangeText={setNik} autoCapitalize="none" accessibilityLabel="NIK" />
      <Text>Password</Text>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry accessibilityLabel="Password" />
      <ErrorText error={error} />
      <Button title={busy ? "Memuat..." : "Masuk"} onPress={() => void submit()} disabled={busy} />
    </View>
  );
}
