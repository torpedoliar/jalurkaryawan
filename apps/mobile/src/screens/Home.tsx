import { Button, Text, View } from "react-native";
import { z } from "zod";
import { Booking, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, RouteSwatch, hhmm, today, useAction, useLoad } from "../ui";

/** Spec 6.2 beranda: bookings for the next 7 days; cancel only before cutoff. */
export function Home() {
  const from = today();
  const list = useLoad(() => api.get(ENDPOINTS.myBookings, z.array(Booking), { from, to: addDays(from, 6) }), [from]);
  const { busy, error, run } = useAction();
  async function cancel(id: string) {
    if (await run(() => api.post(ENDPOINTS.bookingCancel(id), Booking))) list.reload();
  }
  return (
    <View>
      <Text accessibilityRole="header">Beranda</Text>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <Text>Belum ada booking 7 hari ke depan.</Text>}
      {list.data?.map((b) => (
        // Not `accessible`: grouping would hide the Batalkan button from VoiceOver.
        <View key={b.id} testID="booking-card">
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <RouteSwatch color={b.routeColor} />
            <Text style={{ flexShrink: 1, fontWeight: "700" }}>{b.date} · {DIRECTION_LABEL[b.direction]} · {b.routeCode} {b.routeName}</Text>
          </View>
          <Text>{b.stopName}, jemput {hhmm(b.pickupAt)} · bus {b.busPlate}</Text>
          <Text>{BOOKING_STATUS_TEXT[b.status]}</Text>
          {b.status === "BOOKED" && (Date.now() < Date.parse(b.cutoffAt)
            ? <Button title="Batalkan" onPress={() => void cancel(b.id)} disabled={busy} />
            : <Text>Batas batal lewat</Text>)}
        </View>
      ))}
    </View>
  );
}
