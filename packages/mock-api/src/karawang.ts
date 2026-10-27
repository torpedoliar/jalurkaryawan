import { createSeededDb } from "./seed";
import { nowIso } from "./db";

/** Browser demo profile. Fixed-clock regression fixtures keep createSeededDb's original identities. */
export function createKarawangDb(now: () => Date = () => new Date()) {
  const db = createSeededDb(now);
  const routes = [
    { name: "Karawang Barat → PT. Santos Jaya Abadi (Surya Cipta)", stops: ["Alun-alun Karawang", "Galuh Mas", "Telukjambe", "Gerbang Surya Cipta"], coords: [[-6.302,107.299],[-6.326,107.301],[-6.344,107.308],[-6.393,107.319]] },
    { name: "Klari → PT. Santos Jaya Abadi (Surya Cipta)", stops: ["Terminal Klari", "Pasar Klari", "Kosambi", "Gerbang Surya Cipta"], coords: [[-6.347,107.354],[-6.354,107.355],[-6.369,107.368],[-6.393,107.319]] },
    { name: "Karawang Timur → PT. Santos Jaya Abadi (Surya Cipta)", stops: ["Johar Karawang", "Kondang Jaya", "Klari", "Gerbang Surya Cipta"], coords: [[-6.309,107.328],[-6.331,107.345],[-6.347,107.354],[-6.393,107.319]] },
    { name: "Telukjambe → PT. Santos Jaya Abadi (Surya Cipta)", stops: ["Sukaluyu", "Sukaharja", "Wadas", "Gerbang Surya Cipta"], coords: [[-6.332,107.287],[-6.348,107.291],[-6.366,107.302],[-6.393,107.319]] },
    { name: "Ciampel → PT. Santos Jaya Abadi (Surya Cipta)", stops: ["Mulyasari Ciampel", "Kutapohaci", "Kutanegara", "Gerbang Surya Cipta"], coords: [[-6.414,107.335],[-6.435,107.348],[-6.422,107.310],[-6.393,107.319]] },
    { name: "Karawang Kota → PT. Santos Jaya Abadi (Surya Cipta)", stops: ["Stasiun Karawang", "Tuparev", "Interchange Karawang Timur", "Gerbang Surya Cipta"], coords: [[-6.305,107.300],[-6.310,107.312],[-6.363,107.340],[-6.393,107.319]] },
  ];
  for (let i = 0; i < routes.length; i++) {
    const spec = routes[i]!, routeId = `r${i + 1}`;
    db.routes.find((r) => r.id === routeId)!.name = spec.name;
    for (let j = 0; j < spec.stops.length; j++) {
      const id = `${routeId}s${j + 1}`, pos = spec.coords[j]!;
      const value = { id, routeId, name: spec.stops[j]!, seq: j + 1, offsetMinutes: j * 12, lat: pos[0]!, lng: pos[1]!, active: true };
      const existing = db.stops.find((s) => s.id === id);
      if (existing) Object.assign(existing, value); else db.stops.push(value);
    }
  }
  db.vendors[0]!.name = "PT. Lintas Karawang Mandiri";
  db.vendors[1]!.name = "CV. Armada Telukjambe";
  const first = ["Rina", "Budi", "Siti", "Agus", "Dewi", "Eko", "Dedi", "Fitri", "Yudi", "Sri", "Asep", "Nur", "Dian", "Rizki", "Wawan"];
  const last = ["Wulandari", "Santoso", "Rahmawati", "Pratama", "Lestari", "Saputra"];
  const departments = ["Produksi", "Packing", "Quality Control", "Gudang", "Maintenance", "Logistik"];
  db.users.filter((u) => u.role === "EMPLOYEE").forEach((u, i) => {
    u.nik = `000${12345 + i}`;
    u.name = `${first[i % first.length]} ${last[Math.floor(i / first.length) % last.length]}`;
    u.department = departments[i % departments.length]!;
  });
  db.buses.forEach((b, i) => { b.plate = `T ${7101 + i} KR`; });
  // Every trip gets a driver from the bus's own vendor so the fleet table is populated.
  for (const t of db.trips) {
    const bus = db.buses.find((b) => b.id === t.busId)!;
    db.ops.tripDrivers.set(t.id, bus.vendorId === "v1" ? "driver" : "driver2");
  }
  db.routes.forEach((r, i) => { r.code = `KRW-${String(i + 1).padStart(2, "0")}`; });
  db.users.find((u) => u.id === "driver")!.name = "Joko Purnomo";
  db.users.find((u) => u.id === "driver2")!.name = "Hadi Susanto";
  db.users.find((u) => u.id === "vendor")!.name = "Rudi Hartono";
  const current = db.trips.filter((t) => t.date === db.trips[0]?.date && db.ops.tripDrivers.has(t.id))
    .sort((a, b) => Math.abs(Date.parse(a.departureAt) - now().getTime()) - Math.abs(Date.parse(b.departureAt) - now().getTime()))[0];
  if (current) {
    db.ops.executions.push({ tripId: current.id, driverId: db.ops.tripDrivers.get(current.id)!, status: "IN_PROGRESS", startedAt: nowIso(db), endedAt: null });
    db.ops.locations.push({ tripId: current.id, sampleId: "demo-position-01", lat: -6.367, lng: 107.321, accuracy: 15, capturedAt: nowIso(db) });
    const b = db.bookings.find((b) => b.tripId === current.id && b.status === "BOOKED");
    if (b) db.ops.attendance.push({ bookingId: b.id, tripId: current.id, busId: current.busId, checkedInAt: nowIso(db), method: "DRIVER_SCANNER" });
  }
  db.notifications.push({ id: "demo-karawang-welcome", userId: "k1001", type: "REMINDER", title: "Jemputan menuju Surya Cipta", body: "Periksa jadwal dan titik jemput sebelum berangkat. Siapkan QR tiket saat naik bus menuju PT. Santos Jaya Abadi.", data: {}, readAt: null, createdAt: nowIso(db) });
  return db;
}
