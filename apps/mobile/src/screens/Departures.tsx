import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { Departure, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { BOARD, DIRECTION_LABEL, ErrorText, F, RouteSwatch, StatusBadge, hhmm, today, useLoad } from "../ui";

/** Spec 6.2 papan keberangkatan: today or tomorrow, own trips highlighted. All roles (mobile: employee). Styled as station signage. */
export function Departures() {
  const [date, setDate] = useState(today());
  const { data, error } = useLoad(() => api.get(ENDPOINTS.departures, z.array(Departure), { date }), [date]);
  const tomorrow = addDays(today(), 1);
  const day = (label: string, d: string) => (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: date === d }} onPress={() => setDate(d)} style={[b.day, date === d && b.dayOn]}>
      <Text style={[b.dayText, date === d && { color: BOARD.bg }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      <ErrorText error={error} />
      <View style={b.board}>
        <View style={b.head}>
          {/* Header must not duplicate the "Papan Keberangkatan" tab label: auth tests query that string uniquely. */}
          <Text accessibilityRole="header" style={b.title}>Keberangkatan</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>{day("Hari ini", today())}{day("Besok", tomorrow)}</View>
        </View>
        <Text style={[b.dim, { paddingHorizontal: 14, paddingTop: 8 }]}>{date}</Text>
        {(data?.length === 0) && <Text style={[b.dim, { padding: 14 }]}>Belum ada trip.</Text>}
        {data?.map((d) => (
          <View key={d.tripId} accessible accessibilityRole="text" accessibilityState={{ selected: d.mine }} testID={d.mine ? "departure-mine" : "departure"} style={[b.row, d.mine && b.mine]}>
            <Text style={b.time}>{hhmm(d.departureAt)}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <RouteSwatch color={d.routeColor} />
                <Text style={b.route}>{d.routeCode} {d.routeName}</Text>
              </View>
              <Text style={b.dim}>{d.shiftName} · {DIRECTION_LABEL[d.direction]} · {d.busPlate} · {d.bookedCount}/{d.capacity}</Text>
              <View style={b.meter}><View style={{ height: "100%", width: `${Math.min(100, Math.round((d.bookedCount / Math.max(1, d.capacity)) * 100))}%`, backgroundColor: BOARD.ink }} /></View>
            </View>
            <StatusBadge status={d.status} />
          </View>
        ))}
      </View>
    </View>
  );
}

const b = StyleSheet.create({
  board: { backgroundColor: BOARD.bg, borderRadius: 16, overflow: "hidden", paddingBottom: 6 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, padding: 14, borderBottomWidth: 1, borderColor: BOARD.rule },
  title: { fontFamily: F.display, fontSize: 15, letterSpacing: 1, textTransform: "uppercase", color: BOARD.head },
  day: { paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: "#2E3A47" },
  dayOn: { backgroundColor: BOARD.head, borderColor: BOARD.head },
  dayText: { color: BOARD.ink, fontFamily: F.bodyBold, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderColor: BOARD.rule },
  mine: { backgroundColor: BOARD.mine, borderLeftWidth: 4, borderLeftColor: BOARD.head, paddingLeft: 10 },
  time: { fontFamily: F.monoBold, fontSize: 20, color: "#FFFFFF" },
  route: { flexShrink: 1, fontFamily: F.bodyBold, fontSize: 14, color: BOARD.ink },
  dim: { fontFamily: F.mono, fontSize: 12, color: BOARD.dim },
  meter: { height: 4, borderRadius: 2, backgroundColor: "#222C37", overflow: "hidden" },
});
