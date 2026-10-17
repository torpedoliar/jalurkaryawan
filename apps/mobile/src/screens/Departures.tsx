import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { Departure, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { DIRECTION_LABEL, ErrorText, RouteSwatch, StatusBadge, hhmm, today, useLoad } from "../ui";

/** Spec 6.2 papan keberangkatan: today or tomorrow, own trips highlighted. All roles (mobile: employee). */
export function Departures() {
  const [date, setDate] = useState(today());
  const { data, error } = useLoad(() => api.get(ENDPOINTS.departures, z.array(Departure), { date }), [date]);
  const tomorrow = addDays(today(), 1);
  return (
    <View>
      {/* Header must not duplicate the "Papan Keberangkatan" tab label: auth tests query that string uniquely. */}
      <Text accessibilityRole="header">Keberangkatan</Text>
      <View>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: date === today() }} onPress={() => setDate(today())}>
          <Text style={{ fontWeight: date === today() ? "700" : "400" }}>Hari ini</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: date === tomorrow }} onPress={() => setDate(tomorrow)}>
          <Text style={{ fontWeight: date === tomorrow ? "700" : "400" }}>Besok</Text>
        </Pressable>
        <Text>{date}</Text>
      </View>
      <ErrorText error={error} />
      {(data?.length === 0) && <Text>Belum ada trip.</Text>}
      {data?.map((d) => (
        <View key={d.tripId} accessible accessibilityRole="text" accessibilityState={{ selected: d.mine }} testID={d.mine ? "departure-mine" : "departure"}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <RouteSwatch color={d.routeColor} />
            <Text style={{ flexShrink: 1, fontWeight: d.mine ? "700" : "400" }}>
              {hhmm(d.departureAt)} · {d.routeCode} {d.routeName} · {d.shiftName} · {DIRECTION_LABEL[d.direction]} · {d.busPlate} · {d.bookedCount}/{d.capacity} ·
            </Text>
          </View>
          <StatusBadge status={d.status} />
        </View>
      ))}
    </View>
  );
}
