import { useState } from "react";
import { Button, Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { ENDPOINTS, Route, Shift, Subscription, SubscriptionCreateResponse, SubscriptionInput, addDays } from "@bms/shared";
import { api } from "../api";
import { DIRECTION_LABEL, ErrorText, WeekdayPicker, dayNames, today, useAction, useLoad } from "../ui";
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
    <View>
      <Text accessibilityRole="header">Langganan</Text>
      <TripFields value={choice} onChange={setChoice} />
      <View>
        <Text>Mulai</Text>
        <TextInput value={startDate} onChangeText={setStart} placeholder="YYYY-MM-DD" accessibilityLabel="Mulai" />
        <Pressable accessibilityRole="button" testID="mulai-hari-ini" onPress={() => setStart(today())}>
          <Text>Hari ini</Text>
        </Pressable>
        {Array.from({ length: 7 }, (_, i) => addDays(today(), i)).map((d) => (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: startDate === d }} testID={`mulai-${d}`} onPress={() => setStart(d)}>
            <Text style={{ fontWeight: startDate === d ? "700" : "400" }}>{d}</Text>
          </Pressable>
        ))}
      </View>
      <View>
        <Text>Sampai (opsional)</Text>
        <TextInput value={endDate} onChangeText={setEnd} placeholder="YYYY-MM-DD" accessibilityLabel="Sampai (opsional)" />
      </View>
      <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      <ErrorText error={error ?? list.error} />
      {result && (
        <Text accessibilityLiveRegion="polite">{`Terbooked ${result.booked.length} tanggal${result.rejected.length > 0 ? `; penuh: ${result.rejected.join(", ")}` : ""}${result.skippedCutoff.length > 0 ? `; lewat batas: ${result.skippedCutoff.join(", ")}` : ""}`}</Text>
      )}
      <Button title={busy ? "Membuat..." : "Buat langganan"} onPress={() => void submit()} disabled={busy || !ready || !choice.stopId || weekdays.length === 0} />
      {list.data?.length === 0 && <Text>Belum ada langganan.</Text>}
      {list.data?.map((s) => (
        <View key={s.id} testID="subscription-card">
          <Text>{routeCode(s.routeId)} · {shiftName(s.shiftId)} · {DIRECTION_LABEL[s.direction]} · {s.startDate} s/d {s.endDate ?? "seterusnya"} · {dayNames(s.weekdays)} · {s.status === "ACTIVE" ? "Aktif" : "Berakhir"}</Text>
          {s.status === "ACTIVE" && (endId === s.id
            ? <Button title="Ya, akhiri" onPress={() => void end(s.id)} disabled={busy} />
            : <Button title="Akhiri" onPress={() => setEndId(s.id)} />)}
        </View>
      ))}
    </View>
  );
}
