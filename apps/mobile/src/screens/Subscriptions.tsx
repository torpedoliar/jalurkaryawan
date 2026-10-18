import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { ENDPOINTS, Route, Shift, Subscription, SubscriptionCreateResponse, SubscriptionInput, addDays } from "@bms/shared";
import { api } from "../api";
import { Btn, DIRECTION_LABEL, ErrorText, S, Title, chip, chipText, WeekdayPicker, dayNames, today, useAction, useLoad } from "../ui";
import { EMPTY_CHOICE, TripFields, type TripChoice } from "./Book";

/** Spec 6.2 langganan: create, list, end. */
export function Subscriptions() {
  const list = useLoad(() => api.get(ENDPOINTS.mySubscriptions, z.array(Subscription)), []);
  const lookups = useLoad(() => Promise.all([api.get(ENDPOINTS.routes, z.array(Route)), api.get(ENDPOINTS.shifts, z.array(Shift))]), []);
  const [choice, setChoice] = useState<TripChoice>(EMPTY_CHOICE);
  const [startDate, setStart] = useState(today());
  const [endDate, setEnd] = useState("");
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [result, setResult] = useState<SubscriptionCreateResponse | null>(null);
  const [endId, setEndId] = useState("");
  const { busy, error, run } = useAction();
  const routeCode = (id: string) => lookups.data?.[0].find((r) => r.id === id)?.code ?? id;
  const shiftName = (id: string) => lookups.data?.[1].find((s) => s.id === id)?.name ?? id;
  const ready = choice.shiftId && choice.direction && choice.routeId;

  async function submit() {
    // SubscriptionInput.parse throws ZodError inside run, so its message lands in the alert.
    const r = await run(() => api.post(ENDPOINTS.subscriptions, SubscriptionCreateResponse,
      SubscriptionInput.parse({ ...choice, startDate, endDate: endDate || null, weekdays })));
    if (r) { setResult(r); list.reload(); }
  }
  async function end(id: string) {
    if (await run(() => api.post(ENDPOINTS.subscriptionEnd(id), Subscription))) { setEndId(""); list.reload(); }
  }
  return (
    <View style={S.screen}>
      <Title kicker="Jadwal tetap">Langganan</Title>
      <TripFields value={choice} onChange={setChoice} />
      <View style={{ gap: 6 }}>
        <Text style={S.eyebrow}>Mulai</Text>
        <TextInput value={startDate} onChangeText={setStart} placeholder="YYYY-MM-DD" accessibilityLabel="Mulai" style={S.input} />
        <View style={S.chips}>
        <Pressable accessibilityRole="button" testID="mulai-hari-ini" onPress={() => setStart(today())} style={chip(false)}>
          <Text style={chipText(false)}>Hari ini</Text>
        </Pressable>
        {Array.from({ length: 7 }, (_, i) => addDays(today(), i)).map((d) => (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: startDate === d }} testID={`mulai-${d}`} onPress={() => setStart(d)} style={chip(startDate === d)}>
            <Text style={chipText(startDate === d)}>{d}</Text>
          </Pressable>
        ))}
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={S.eyebrow}>Sampai (opsional)</Text>
        <TextInput value={endDate} onChangeText={setEnd} placeholder="YYYY-MM-DD" accessibilityLabel="Sampai (opsional)" style={S.input} />
      </View>
      <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      <ErrorText error={error ?? list.error} />
      {result && (
        <Text accessibilityLiveRegion="polite" style={S.text}>{`Terbooked ${result.booked.length} tanggal${result.rejected.length > 0 ? `; penuh: ${result.rejected.join(", ")}` : ""}${result.skippedCutoff.length > 0 ? `; lewat batas: ${result.skippedCutoff.join(", ")}` : ""}`}</Text>
      )}
      <Btn primary title={busy ? "Membuat..." : "Buat langganan"} onPress={() => void submit()} disabled={busy || !ready || !choice.stopId || weekdays.length === 0} />
      {list.data?.length === 0 && <Text style={S.text}>Belum ada langganan.</Text>}
      {list.data?.map((s) => (
        <View key={s.id} testID="subscription-card" style={S.card}>
          <Text style={S.text}>{routeCode(s.routeId)} · {shiftName(s.shiftId)} · {DIRECTION_LABEL[s.direction]} · {s.startDate} s/d {s.endDate ?? "seterusnya"} · {dayNames(s.weekdays)} · {s.status === "ACTIVE" ? "Aktif" : "Berakhir"}</Text>
          {s.status === "ACTIVE" && (endId === s.id
            ? <Btn title="Ya, akhiri" onPress={() => void end(s.id)} disabled={busy} />
            : <Btn title="Akhiri" onPress={() => setEndId(s.id)} />)}
        </View>
      ))}
    </View>
  );
}
