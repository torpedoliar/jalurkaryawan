import { Text, View } from "react-native";
import { z } from "zod";
import { Booking, ENDPOINTS } from "@bms/shared";
import { api } from "../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, F, RouteSwatch, S, Title, hhmm, useLoad } from "../ui";

/** Spec 6.2 riwayat: every booking, newest first. */
export function History() {
  const { data, error } = useLoad(
    () => api.get(ENDPOINTS.myBookings, z.array(Booking)).then((rows) => rows.sort((a, b) => b.departureAt.localeCompare(a.departureAt))),
    [],
  );
  return (
    <View style={S.screen}>
      <Title kicker="Semua booking">Riwayat</Title>
      <ErrorText error={error} />
      {data?.length === 0 && <Text style={S.text}>Belum ada riwayat booking.</Text>}
      {data?.map((b) => (
        <View key={b.id} accessible accessibilityRole="summary" testID="history-row" style={[S.card, { flexDirection: "row", alignItems: "center" }]}>
          <RouteSwatch color={b.routeColor} />
          <Text style={[S.text, { flex: 1 }]}>{b.date} · {hhmm(b.departureAt)} · {b.routeCode} {b.routeName} · {DIRECTION_LABEL[b.direction]} · {b.stopName} · {BOOKING_STATUS_TEXT[b.status]}</Text>
        </View>
      ))}
    </View>
  );
}
