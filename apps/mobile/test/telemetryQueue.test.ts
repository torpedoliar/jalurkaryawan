import { discardLocations, drainLocations, enqueueLocations, GPS_QUEUE_LIMIT, GPS_QUEUE_TTL_MS } from "../src/telemetryQueue";
const sample = (id: number, timestamp = Date.now()) => ({ sampleId: `sample-${String(id).padStart(5, "0")}`, lat: 1, lng: 2, accuracy: 3, speed: null, heading: null, capturedAt: new Date(timestamp).toISOString() });
it("retains failed uploads with stable IDs and drains after connection returns", async () => {
  await enqueueLocations("a", [sample(1), sample(2)]);
  await expect(drainLocations("a", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  const send = jest.fn().mockResolvedValue(undefined);
  await drainLocations("a", send);
  expect(send.mock.calls[0][0].map((s: { sampleId: string }) => s.sampleId)).toEqual(["sample-00001", "sample-00002"]);
  await drainLocations("a", send);
  expect(send).toHaveBeenCalledTimes(1);
});
it("caps queue size and expires samples; batches never exceed 100", async () => {
  await enqueueLocations("a", [sample(999, Date.now() - GPS_QUEUE_TTL_MS - 1), ...Array.from({ length: 105 }, (_, i) => sample(i))]);
  const send = jest.fn().mockResolvedValue(undefined);
  await drainLocations("a", send);
  expect(send.mock.calls[0][0]).toHaveLength(GPS_QUEUE_LIMIT);
  expect(send.mock.calls[0][0].map((s: { sampleId: string }) => s.sampleId)).not.toContain("sample-00000");
  expect(send.mock.calls[0][0].map((s: { sampleId: string }) => s.sampleId)).toContain("sample-00005");
});
it("discards only ended trip and all records on logout", async () => {
  await enqueueLocations("a", [sample(1)]); await enqueueLocations("b", [sample(2)]);
  await discardLocations("a");
  const send = jest.fn().mockResolvedValue(undefined);
  await drainLocations("a", send); expect(send).not.toHaveBeenCalled();
  await drainLocations("b", send); expect(send).toHaveBeenCalledTimes(1);
  await enqueueLocations("b", [sample(3)]); await discardLocations();
  await drainLocations("b", send); expect(send).toHaveBeenCalledTimes(1);
});
