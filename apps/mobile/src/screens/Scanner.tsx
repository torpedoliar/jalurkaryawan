import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { dataWedge } from "../datawedge";
import { Btn, ErrorText, S } from "../ui";

/** One in-flight request per scanner. Never equates a decode with successful boarding. */
export function Scanner({ onScan, onClose, zebra = false }: { onScan(value: string, method: "CAMERA" | "DATAWEDGE"): Promise<void>; onClose(): void; zebra?: boolean }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [pendingHardware, setPendingHardware] = useState<string | null>(null);
  const locked = useRef(false);
  const handler = useRef(onScan);
  handler.current = onScan;
  const decode = useRef(async (value: string, method: "CAMERA" | "DATAWEDGE") => {
    if (locked.current || !value.trim()) return;
    locked.current = true; setBusy(true); setScanned(true); setError(null);
    try { await handler.current(value, method); }
    catch (e) { setError(e instanceof Error ? e.message : "Gagal menghubungi server. Belum check-in."); }
    finally { setBusy(false); }
  }).current;
  useEffect(() => {
    const native = dataWedge;
    if (!zebra || !native) return;
    let live = true;
    let confirmed = false;
    setNativeReady(false);
    const subscription = native.addListener("onScan", ({ data }) => { if (confirmed && !locked.current && data.trim()) setPendingHardware(data); });
    void native.start().then(() => { if (live) { confirmed = true; setNativeReady(true); } }).catch(() => { if (live) setError("DataWedge belum dikonfirmasi. Gunakan kamera."); });
    return () => { live = false; confirmed = false; subscription.remove(); void native.stop().catch(() => undefined); };
  }, [zebra, decode]);
  return <View style={S.card}>
    <Text style={S.text}>Pindai QR. Check-in hanya berhasil setelah konfirmasi server.</Text>
    {zebra && <Text style={S.text}>{dataWedge ? nativeReady ? "Profil Zebra dikonfirmasi DataWedge." : "Menunggu konfirmasi profil DataWedge; kamera tersedia." : "DataWedge memerlukan development/native build Android. Kamera tetap tersedia."}</Text>}
    <ErrorText error={error} />
    {pendingHardware && <View>
      <Text style={S.text}>Scanner menerima QR. Konfirmasi untuk memverifikasi check-in ke server.</Text>
      <Btn title="Konfirmasi scan scanner" disabled={busy} onPress={() => { const value = pendingHardware; setPendingHardware(null); void decode(value, "DATAWEDGE"); }} />
      <Btn title="Abaikan scan" disabled={busy} onPress={() => setPendingHardware(null)} />
    </View>}
    {permission?.granted
      ? <CameraView style={{ height: 280, width: "100%" }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned ? undefined : ({ data }) => { void decode(data, "CAMERA"); }} />
      : <Btn title="Izinkan kamera" onPress={() => { void requestPermission().catch(() => setError("Izin kamera gagal.")); }} />}
    {permission && !permission.granted && <Text style={S.text}>Jika izin ditolak permanen, aktifkan kamera di pengaturan perangkat.</Text>}
    {scanned && <Btn title={busy ? "Memverifikasi server..." : "Pindai lagi"} disabled={busy} onPress={() => { locked.current = false; setScanned(false); setError(null); }} />}
    <Btn title="Tutup pemindai" disabled={busy} onPress={onClose} />
  </View>;
}
