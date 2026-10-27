import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { activeTracking, startTracking, stopTracking, trackingError } from "../tracking";
import { Btn, ErrorText, S } from "../ui";
import { flushTelemetry, operations } from "../operations";
import { discardLocations } from "../telemetryQueue";

export function TrackingControls({ tripId }: { tripId: string }) {
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => { void activeTracking().then((value) => { if (live) { setActive(value); setError(trackingError()); if (value) void flushTelemetry(value).catch(() => { if (live) setError("Lokasi menunggu koneksi; belum diterima server."); }); } }).catch(() => { if (live) setError("Status GPS tidak tersedia."); }); };
    refresh();
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    const timer = setInterval(refresh, 10000);
    return () => { live = false; listener.remove(); clearInterval(timer); };
  }, []);
  async function change(start: boolean) {
    setBusy(true); setError(null); setMessage(null);
    try {
      if (start) {
        // Read actual OS/context state, not a possibly stale render, before creating a server run.
        const current = await activeTracking();
        if (current && current !== tripId) throw new Error("Akhiri pelacakan perjalanan sebelumnya terlebih dahulu.");
        await operations.start(tripId);
        setMessage("Perjalanan dimulai (dikonfirmasi server). Izin GPS terpisah dari check-in.");
        await startTracking(tripId);
      } else {
        await stopTracking(tripId);
      }
      setActive(await activeTracking());
    } catch (e) { setError(e instanceof Error ? e.message : "GPS gagal. Check-in tetap tersedia."); }
    finally { setBusy(false); }
  }
  return <View style={S.card}>
    <Text accessibilityLiveRegion="polite" style={S.text}>{active === tripId ? "GPS aktif untuk perjalanan ini" : active ? "GPS aktif untuk perjalanan lain" : "GPS tidak aktif"}</Text>
    <Text style={S.text}>Lokasi hanya dibagikan setelah Anda mulai. Status aktif bukan konfirmasi lokasi telah diterima server. Check-in tidak memerlukan izin GPS.</Text>
    <ErrorText error={error} />
    {message && <Text accessibilityLiveRegion="polite" style={S.text}>{message}</Text>}
    <Btn title="Akhiri perjalanan dan GPS" disabled={busy} onPress={() => {
      setBusy(true); setError(null); setMessage(null);
      void (async () => {
        try { await stopTracking(tripId); setActive(await activeTracking()); await discardLocations(tripId); await operations.end(tripId); setMessage("Akhir perjalanan dikonfirmasi server."); }
        catch (e) { setError(e instanceof Error ? e.message : "Server belum mengonfirmasi akhir perjalanan."); }
        finally { setBusy(false); }
      })();
    }} />
    {active === tripId ? <Btn title="Akhiri GPS" disabled={busy} onPress={() => { void change(false); }} /> : <Btn title="Mulai GPS perjalanan" disabled={busy} onPress={() => { void change(true); }} />}
  </View>;
}
