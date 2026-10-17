import { useCallback, useEffect, useState } from "react";
import { Button, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { ENDPOINTS, SetupStatus, type Me } from "@bms/shared";
import { api, apiEvents, loadSession, logout } from "./api";
import { AuthContext } from "./auth";
import { today } from "./ui";
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
    apiEvents.loggedOut = () => setMe(null);
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
  const pushReady = me !== null && me.role === "EMPLOYEE" && !me.mustChangePassword;
  useEffect(() => { if (pushReady) void registerPush(); }, [pushReady]);

  const back = useCallback(() => { setMaintenance(false); setBootKey((k) => k + 1); }, []);
  const signOut = useCallback(async () => { await unregisterPush(); await logout(); setMe(null); }, []);

  if (maintenance) return <Maintenance onDone={back} />;
  if (boot === "loading") return <View><Text>Memuat...</Text></View>;
  if (boot === "setup") {
    return (
      <View>
        <Text accessibilityRole="header">Setup Awal</Text>
        <Text>Belum ada Super Admin.</Text>
        <Text>Hubungi admin untuk setup awal lewat web.</Text>
      </View>
    );
  }

  return (
    <AuthContext.Provider value={{ me, setMe, signOut }}>
      {!me ? <Login />
        : me.mustChangePassword ? <ChangePassword forced />
        : me.role !== "EMPLOYEE" ? (
          <View>
            <Text>Aplikasi ini khusus karyawan. Gunakan web.</Text>
            <Button title="Keluar" onPress={() => void signOut()} />
          </View>
        ) : (
          <SafeAreaView style={{ flex: 1 }}>
            <StatusBar style="auto" />
            <ScrollView>
              <Text>{me.name}</Text>
              {TABS.map((t) => (
                <Pressable key={t.id} accessibilityRole="button" accessibilityState={{ selected: tab === t.id }} onPress={() => setTab(t.id)}>
                  <Text style={{ fontWeight: tab === t.id ? "700" : "400" }}>{t.label}</Text>
                </Pressable>
              ))}
              <Button title="Keluar" onPress={() => void signOut()} />
              {me.bookingSuspendedUntil !== null && me.bookingSuspendedUntil >= today() && (
                <Text accessibilityLiveRegion="polite">
                  Booking kamu dibekukan sampai {me.bookingSuspendedUntil}. Alasan: {me.suspendReason}
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
          </SafeAreaView>
        )}
    </AuthContext.Provider>
  );
}
