import { StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { Booking, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { BOOKING_STATUS_TEXT, Btn, C, DIRECTION_LABEL, ErrorText, F, RouteSwatch, S, Title, hhmm, today, useAction, useLoad } from "../ui";

/** Spec 6.2 beranda: bookings for the next 7 days; cancel only before cutoff. Rendered as boarding-pass tickets. */
export function Home() {
  const from = today();
  const list = useLoad(() => api.get(ENDPOINTS.myBookings, z.array(Booking), { from, to: addDays(from, 6) }), [from]);
  const { busy, error, run } = useAction();
  async function cancel(id: string) {
    if (await run(() => api.post(ENDPOINTS.bookingCancel(id), Booking))) list.reload();
  }
  return (
    <View style={S.screen}>
      <Title kicker="7 hari ke depan">Beranda</Title>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <Text style={S.text}>Belum ada booking 7 hari ke depan.</Text>}
      {list.data?.map((b) => {
        const [origin, dest] = b.direction === "PICKUP" ? [b.stopName, "Kantor"] : ["Kantor", b.stopName];
        const off = b.status !== "BOOKED";
        return (
          // Not `accessible`: grouping would hide the Batalkan button from VoiceOver.
          <View key={b.id} testID="booking-card" style={[t.ticket, off && { opacity: 0.6 }]}>
            <View style={{ height: 8, backgroundColor: b.routeColor }} />
            <View style={t.top}>
              <View style={t.row}>
                <RouteSwatch color={b.routeColor} />
                <Text style={[t.dir, { color: b.routeColor }]}>{DIRECTION_LABEL[b.direction]} · {b.routeCode} {b.routeName}</Text>
                <Text style={t.tag}>{b.source === "SUBSCRIPTION" ? "LANGGANAN" : "HARIAN"}</Text>
              </View>
              <View style={[t.row, { justifyContent: "space-between" }]}>
                <Text style={S.eyebrow}>{b.date}</Text>
                <Text style={S.eyebrow}>{BOOKING_STATUS_TEXT[b.status]}</Text>
              </View>
              <View style={t.row}>
                <Text style={[t.stop, off && t.struck]}>{origin}</Text>
                <View style={[t.bar, { backgroundColor: b.routeColor }]} />
                <Text style={[t.stop, { textAlign: "right" }, off && t.struck]}>{dest}</Text>
              </View>
            </View>
            {/* Perforation: dashed rule between the ticket and its stub. */}
            <View style={t.perf} />
            <View style={[t.row, t.stub]}>
              <Field k={DIRECTION_LABEL[b.direction]} v={hhmm(b.pickupAt)} />
              <Field k="Bus" v={b.busPlate} />
              <Field k="Sisa kursi" v={`${b.seatsLeft}/${b.capacity}`} />
            </View>
            {b.status === "BOOKED" && (
              <View style={[t.row, t.act]}>
                {Date.now() < Date.parse(b.cutoffAt)
                  ? <><Text style={t.small}>Batal maks. {hhmm(b.cutoffAt)}</Text><Btn title="Batalkan" onPress={() => void cancel(b.id)} disabled={busy} /></>
                  : <Text style={t.small}>Batas batal lewat</Text>}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={[S.eyebrow, { fontSize: 10 }]}>{k}</Text>
      <Text style={{ fontFamily: F.monoBold, fontSize: 16, color: C.ink }}>{v}</Text>
    </View>
  );
}

const t = StyleSheet.create({
  ticket: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: "hidden" },
  top: { padding: 14, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dir: { flex: 1, fontFamily: F.monoBold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" },
  tag: { fontFamily: F.monoBold, fontSize: 11, color: C.muted, backgroundColor: C.sunk, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: "hidden" },
  stop: { flex: 1, fontFamily: F.display, fontSize: 19, color: C.ink },
  struck: { textDecorationLine: "line-through" },
  bar: { width: 40, height: 3 },
  perf: { borderTopWidth: 2, borderStyle: "dashed", borderColor: C.line, marginHorizontal: 12 },
  stub: { padding: 14, alignItems: "flex-start" },
  act: { justifyContent: "space-between", paddingHorizontal: 14, paddingBottom: 14 },
  small: { fontFamily: F.mono, fontSize: 12, color: C.muted },
});
