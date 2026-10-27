import { useState } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import { DriverTrip, operations } from "../operations";
import { Btn, ErrorText, S, Title, today, useLoad } from "../ui";
import { Scanner } from "./Scanner";
import { TrackingControls } from "./TrackingControls";

type Trip = z.infer<typeof DriverTrip>;
export function Driver() {
  const trips = useLoad(() => operations.trips(today()), []);
  const [selected, setSelected] = useState<Trip | null>(null);
  return <View style={S.screen}>
    <Title kicker="Pengemudi">Perjalanan Saya</Title>
    {selected ? <DriverManifest key={selected.tripId} trip={selected} onBack={() => setSelected(null)} /> : <>
      <ErrorText error={trips.error} />
      <Btn title="Muat ulang perjalanan" onPress={trips.reload} />
      {trips.data?.length === 0 && <Text style={S.text}>Tidak ada perjalanan ditugaskan hari ini.</Text>}
      {trips.data?.map((trip) => <View key={trip.tripId} style={S.card}>
        <Text style={S.text}>{trip.routeCode} · {trip.routeName}</Text>
        <Text style={S.text}>{trip.departureAt} · {trip.busPlate} · {trip.execution}</Text>
        <Btn title="Buka manifest" onPress={() => setSelected(trip)} />
      </View>)}
    </>}
  </View>;
}
function DriverManifest({ trip, onBack }: { trip: Trip; onBack(): void }) {
  const manifest = useLoad(() => operations.manifest(trip.tripId), [trip.tripId]);
  const [scan, setScan] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return <View style={S.screen}>
    <Btn title="Kembali ke perjalanan" onPress={onBack} />
    <Text style={S.text}>{trip.routeCode} · {trip.busPlate} · {trip.departureAt}</Text>
    <TrackingControls tripId={trip.tripId} />
    <Text accessibilityLiveRegion="polite" style={S.text}>{message}</Text>
    <Btn title="Pindai tiket penumpang" onPress={() => { setMessage(null); setScan(true); }} />
    {scan && <Scanner zebra onClose={() => setScan(false)} onScan={async (payload, method) => {
      setMessage(null);
      const result = await operations.checkin(trip.tripId, payload, method);
      setMessage(result.alreadyCheckedIn ? "Penumpang sudah check-in (dikonfirmasi server)." : "Check-in dikonfirmasi server.");
      manifest.reload();
    }} />}
    <ErrorText error={manifest.error} />
    <Btn title="Muat ulang manifest" onPress={manifest.reload} />
    {manifest.data?.length === 0 && <Text style={S.text}>Belum ada penumpang.</Text>}
    {manifest.data?.map((row) => <View key={row.bookingId} style={S.card}>
      <Text style={S.text}>{row.name}</Text>
      <Text style={S.text}>{row.stopName} · {row.pickupAt}</Text>
      <Text style={S.text}>{row.checkedInAt ? `Check-in: ${row.checkedInAt}` : "Belum check-in"}</Text>
    </View>)}
  </View>;
}
