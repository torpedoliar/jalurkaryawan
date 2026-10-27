import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { z } from "zod";
import { BusPosition, ENDPOINTS, LOCATION_STALE_SECONDS } from "@bms/shared";
import { api } from "../../api";
import { DIRECTION_LABEL, ErrorText, PageHeader, Panel, hhmm, today, useLoad } from "../../ui";

const tileUrl = import.meta.env.VITE_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const attribution = import.meta.env.VITE_MAP_ATTRIBUTION ?? "&copy; OpenStreetMap contributors";
const EXECUTION = { NOT_STARTED: "Belum mulai", IN_PROGRESS: "Berjalan", COMPLETED: "Selesai" };
export function locationLabel(b: BusPosition, now: number): string {
  if (!b.position) return "Belum ada lokasi";
  const seconds = Math.max(0, Math.floor((now - Date.parse(b.position.capturedAt)) / 1000));
  const age = seconds < 60 ? `${seconds} detik` : `${Math.floor(seconds / 60)} menit`;
  return `${seconds > LOCATION_STALE_SECONDS || b.execution !== "IN_PROGRESS" ? "Lokasi terakhir" : "Diperbarui"} ${age} lalu`;
}

function FleetMap({ rows, now }: { rows: BusPosition[]; now: number }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const markers = useRef<L.LayerGroup>();
  const fitKey = useRef("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const m = L.map(container.current).setView([-6.3, 107.15], 11);
    if (tileUrl) L.tileLayer(tileUrl, { attribution, maxZoom: 19 }).on("tileerror", () => setFailed(true)).addTo(m);
    map.current = m;
    markers.current = L.layerGroup().addTo(m);
    return () => { m.remove(); map.current = undefined; };
  }, []);
  useEffect(() => {
    if (!map.current || !markers.current) return;
    markers.current.clearLayers();
    const located = rows.filter((r) => r.position);
    for (const b of located) {
      const p = b.position!;
      const stale = now - Date.parse(p.capturedAt) > LOCATION_STALE_SECONDS * 1000 || b.execution !== "IN_PROGRESS";
      // Use DOM textContent for server strings; do not interpolate route/plate into HTML.
      const pin = document.createElement("div");
      pin.className = `fleet-pin${stale ? " stale" : ""}`;
      pin.style.setProperty("--c", b.routeColor);
      const badge = document.createElement("span");
      badge.className = "fleet-pin-icon";
      badge.textContent = "BUS";
      const info = document.createElement("span");
      info.className = "fleet-pin-info";
      const plate = document.createElement("strong");
      plate.textContent = b.busPlate;
      const route = document.createElement("small");
      route.textContent = `${b.routeCode} · ${DIRECTION_LABEL[b.direction]}`;
      info.append(plate, route);
      const dot = document.createElement("span");
      dot.className = "fleet-pin-status";
      dot.title = stale ? "Lokasi terakhir" : "Lokasi terbaru";
      pin.append(badge, info, dot);
      const popup = document.createElement("div");
      popup.className = "fleet-popup";
      const heading = document.createElement("strong");
      heading.textContent = b.busPlate;
      popup.append(heading);
      for (const text of [
        `Rute ${b.routeCode} · ${DIRECTION_LABEL[b.direction]}`,
        `Sopir: ${b.driverName ?? "Belum ditugaskan"}`,
        `Berangkat: ${hhmm(b.departureAt)} · ${EXECUTION[b.execution]}`,
        locationLabel(b, now),
        `Akurasi: ${p.accuracy === null ? "tidak tersedia" : `${Math.round(p.accuracy)} m`}`,
      ]) {
        const line = document.createElement("span"); line.textContent = text; popup.append(line);
      }
      L.marker([p.lat, p.lng], {
        title: `Bus ${b.busPlate} · ${b.routeCode}`,
        icon: L.divIcon({ html: pin, className: "fleet-marker", iconSize: [170, 54], iconAnchor: [85, 62], popupAnchor: [0, -60] }),
      }).bindPopup(popup).addTo(markers.current);
    }
    const key = located.map((b) => b.tripId).join(",");
    if (located.length && key !== fitKey.current) map.current.fitBounds(L.latLngBounds(located.map((b) => [b.position!.lat, b.position!.lng])), { padding: [40, 40], maxZoom: 14 });
    fitKey.current = key;
  }, [rows, now]);
  return <div className="map-wrap"><div className="map" ref={container} role="application" aria-label="Peta tracking bus" /><p className="map-note">Posisi berasal dari GPS perangkat sopir. Setiap pin menampilkan nomor plat bus dan rute. Klik pin untuk detail sopir dan perjalanan. Titik abu-abu berarti lokasi lama atau perjalanan selesai.{failed && " Peta dasar gagal dimuat; posisi tetap tersedia di tabel."}</p></div>;
}

export function Tracking() {
  const [date, setDate] = useState(today());
  const [routeId, setRouteId] = useState("");
  const [now, setNow] = useState(Date.now());
  const feed = useLoad(() => api.get(ENDPOINTS.tracking, z.array(BusPosition), { date }), [date]);
  useEffect(() => {
    const id = window.setInterval(() => { setNow(Date.now()); feed.reload(); }, 15_000);
    return () => window.clearInterval(id);
  }, [feed.reload]);
  const rows = (feed.data ?? []).filter((b) => !routeId || b.routeId === routeId);
  const routes = [...new Map((feed.data ?? []).map((b) => [b.routeId, b.routeCode])).entries()];
  return <>
    <PageHeader title="Tracking Bus" eyebrow="Operasional" description="Lokasi GPS perangkat sopir, diperbarui tiap 15 detik. Waktu pembaruan ditampilkan agar lokasi lama tidak dianggap langsung."
      actions={<><label>Tanggal<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setRouteId(""); }} /></label><label>Rute<select value={routeId} onChange={(e) => setRouteId(e.target.value)}><option value="">Semua</option>{routes.map(([id, code]) => <option key={id} value={id}>{code}</option>)}</select></label><button onClick={feed.reload}>Muat ulang</button></>} />
    <ErrorText error={feed.error} />
    {!feed.error && <FleetMap rows={rows} now={now} />}
    <Panel>
      <table><caption>Posisi armada</caption><thead><tr><th>Bus</th><th>Rute</th><th>Berangkat</th><th>Sopir</th><th>Perjalanan</th><th>Lokasi</th><th>Koordinat</th></tr></thead>
        <tbody>{rows.map((b) => <tr key={b.tripId}><td>{b.busPlate}</td><td>{b.routeCode} {DIRECTION_LABEL[b.direction]}</td><td>{hhmm(b.departureAt)}</td><td>{b.driverName ?? "Belum ditugaskan"}</td><td>{EXECUTION[b.execution]}</td><td>{locationLabel(b, now)}</td><td>{b.position ? `${b.position.lat.toFixed(6)}, ${b.position.lng.toFixed(6)}` : "—"}</td></tr>)}</tbody>
      </table>
      {feed.data && rows.length === 0 && <p className="empty-note">Tidak ada trip untuk filter ini.</p>}
    </Panel>
  </>;
}
