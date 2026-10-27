import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ENDPOINTS, SELF_SERVICE_ROLES, SetupStatus, type Me } from "@bms/shared";
import { api, apiEvents, loadSession, logout } from "./api";
import { AuthContext } from "./auth";
import { Btn, C, F, S, chip, chipText, today } from "./ui";
import { registerPush, unregisterPush } from "./push";
import { Login } from "./screens/Login";
import { ChangePassword } from "./screens/ChangePassword";
import { Maintenance } from "./screens/Maintenance";
import { Home } from "./screens/Home";
import { Book } from "./screens/Book";
import { Subscriptions } from "./screens/Subscriptions";
import { History } from "./screens/History";
import { Notifications } from "./screens/Notifications";
import { Departures } from "./screens/Departures";
import { stopTracking } from "./tracking";
import { Driver } from "./screens/Driver";

export type Tab = "beranda" | "booking" | "langganan" | "riwayat" | "notifikasi" | "keberangkatan" | "ganti-password";
const TABS: { id: Tab; label: string }[] = [
  { id: "beranda", label: "Beranda" },
  { id: "booking", label: "Booking Harian" },
  { id: "langganan", label: "Langganan" },
  { id: "riwayat", label: "Riwayat" },
  { id: "notifikasi", label: "Notifikasi" },
  { id: "keberangkatan", label: "Papan Keberangkatan" },
  { id: "ganti-password", label: "Ganti Password" },
];

type Boot = "loading" | "setup" | "ready";

export function App({ initialTab }: { initialTab?: string }) {
  const [boot, setBoot] = useState<Boot>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [bootKey, setBootKey] = useState(0);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "beranda");

  useEffect(() => {
    apiEvents.maintenance = () => setMaintenance(true);
    apiEvents.loggedOut = () => { void stopTracking().catch(() => undefined); setMe(null); };
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const { needsSetup } = await api.get(ENDPOINTS.setupStatus, SetupStatus);
      if (needsSetup) return live && setBoot("setup");
      const m = await loadSession();
      if (live) { setMe(m); setBoot("ready"); }
    })().catch(() => { if (live) setBoot("ready"); });
    return () => { live = false; };
  }, [bootKey]);

  // One place for every way a session becomes usable: form login, SecureStore restore, forced password change.
  const pushReady = me !== null && SELF_SERVICE_ROLES.includes(me.role) && !me.mustChangePassword;
  useEffect(() => { if (pushReady) void registerPush(); }, [pushReady]);

  const back = useCallback(() => { setMaintenance(false); setBootKey((k) => k + 1); }, []);
  const signOut = useCallback(async () => { try { await stopTracking(); } finally { await unregisterPush(); await logout(); setMe(null); } }, []);

  if (maintenance) return <Maintenance onDone={back} />;
  if (boot === "loading") return <View style={a.center}><Text style={S.eyebrow}>Memuat...</Text></View>;
  if (boot === "setup") {
    return (
      <View style={a.center}>
        <View style={S.card}>
          <Text accessibilityRole="header" style={S.title}>Setup Awal</Text>
          <Text style={S.text}>Belum ada Super Admin.</Text>
          <Text style={S.text}>Hubungi admin untuk setup awal lewat web.</Text>
        </View>
      </View>
    );
  }

  return (
    <AuthContext.Provider value={{ me, setMe, signOut }}>
      {!me ? <Login />
        : me.mustChangePassword ? <ChangePassword forced />
        : me.role === "DRIVER" ? (
          <View style={{ flex: 1, backgroundColor: C.bg }}>
            <View style={a.bar}><Text style={S.text}>{me.name} · Pengemudi</Text><Btn title="Keluar" onPress={() => void signOut()} /></View>
            <ScrollView contentContainerStyle={a.body}><Driver /></ScrollView>
          </View>
        ) : !SELF_SERVICE_ROLES.includes(me.role) ? (
          <View style={a.center}>
            <View style={S.card}>
              <Text style={S.text}>Akun ini tidak memakai aplikasi mobile. Gunakan web.</Text>
              <Btn title="Keluar" onPress={() => void signOut()} />
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, backgroundColor: C.bg }}>
            <View style={a.bar}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={a.brand}>Jalur <Text style={a.mark}> Karyawan </Text></Text>
                <Text style={S.eyebrow}>{me.nik}</Text>
                <Text style={[S.text, { fontFamily: F.bodyBold }]}>{me.name}</Text>
              </View>
              <Btn title="Keluar" onPress={() => void signOut()} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={a.tabs}>
              {TABS.map((t) => (
                <Pressable key={t.id} accessibilityRole="button" accessibilityState={{ selected: tab === t.id }} onPress={() => setTab(t.id)} style={chip(tab === t.id)}>
                  <Text style={chipText(tab === t.id)}>{t.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView contentContainerStyle={a.body}>
              {me.bookingSuspendedUntil !== null && me.bookingSuspendedUntil >= today() && (
                <Text accessibilityLiveRegion="polite" style={a.banner}>
                  Booking kamu dibekukan sampai {me.bookingSuspendedUntil}.{me.suspendReason ? ` Alasan: ${me.suspendReason}` : ""}
                </Text>
              )}
              {tab === "beranda" && <Home />}
              {tab === "booking" && <Book />}
              {tab === "langganan" && <Subscriptions />}
              {tab === "riwayat" && <History />}
              {tab === "notifikasi" && <Notifications />}
              {tab === "keberangkatan" && <Departures />}
              {tab === "ganti-password" && <ChangePassword />}
            </ScrollView>
          </View>
        )}
    </AuthContext.Provider>
  );
}

const a = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, backgroundColor: C.surface, borderBottomWidth: 3, borderColor: C.ink },
  brand: { fontFamily: F.black, fontSize: 24, color: C.ink },
  mark: { backgroundColor: C.signal, color: C.signalInk },
  tabs: { gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  body: { padding: 16, paddingBottom: 40, gap: 14 },
  center: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: C.bg },
  banner: { backgroundColor: C.signal, color: C.signalInk, padding: 12, borderRadius: 12, fontFamily: F.bodyBold, overflow: "hidden" },
});
