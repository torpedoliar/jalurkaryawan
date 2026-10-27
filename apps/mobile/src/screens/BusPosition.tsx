import { useEffect } from "react";
import { Text, View } from "react-native";
import { LOCATION_STALE_SECONDS } from "@bms/shared";
import { operations } from "../operations";
import { Btn, ErrorText, S, useLoad } from "../ui";

export function BusPosition({ bookingId, onClose }: { bookingId: string; onClose(): void }) {
  const position = useLoad(() => operations.position(bookingId), [bookingId]);
  useEffect(() => { const timer = setInterval(position.reload, 15000); return () => clearInterval(timer); }, [position.reload]);
  const sample = position.data?.position;
  const age = sample ? Math.max(0, Math.floor((Date.now() - Date.parse(sample.capturedAt)) / 1000)) : null;
  return <View style={S.card}>
    <Text style={S.text}>Posisi bus {position.data?.busPlate ?? ""}</Text>
    <ErrorText error={position.error} />
    {!sample ? <Text style={S.text}>Belum ada lokasi bus.</Text> : <>
      <Text style={S.text}>{sample.lat.toFixed(6)}, {sample.lng.toFixed(6)}</Text>
      <Text accessibilityLiveRegion="polite" style={S.text}>{position.error || age! > LOCATION_STALE_SECONDS ? "Posisi terakhir (bukan live)" : "Lokasi terbaru"} · {age} detik lalu</Text>
      <Text style={S.text}>Diperbarui {sample.capturedAt}; akurasi {sample.accuracy ?? "tidak diketahui"} m.</Text>
    </>}
    <Btn title="Perbarui posisi" onPress={position.reload} />
    <Btn title="Tutup posisi bus" onPress={onClose} />
  </View>;
}
