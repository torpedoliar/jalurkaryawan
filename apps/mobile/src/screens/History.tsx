import { Text, View } from "react-native";
import { z } from "zod";
import { Booking, ENDPOINTS } from "@bms/shared";
import { api } from "../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, hhmm, useLoad } from "../ui";

/** Spec 6.2 riwayat: every booking, newest first. */
export function History() {
  const { data, error } = useLoad(
    () => api.get(ENDPOINTS.myBookings, z.array(Booking)).then((rows) => rows.sort((a, b) => b.departureAt.localeCompare(a.departureAt))),
    [],
  );
  return (
    <View>
      <Text accessibilityRole="header">Riwayat</Text>
      <ErrorText error={error} />
      {data?.length === 0 && <Text>Belum ada riwayat booking.</Text>}
      {data?.map((b) => (
        <View key={b.id} accessible accessibilityRole="row">
          <Text>{b.date} · {hhmm(b.departureAt)} · {b.routeCode} {b.routeName} · {DIRECTION_LABEL[b.direction]} · {b.stopName} · {BOOKING_STATUS_TEXT[b.status]}</Text>
        </View>
      ))}
    </View>
  );
}
