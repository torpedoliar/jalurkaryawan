import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapStop { id: string; name: string; seq: number; lat: number | null; lng: number | null; active: boolean }
export interface LatLng { lat: number; lng: number }

/** Tiles come from env so production can use a licensed provider; empty URL hides the basemap but keeps editing usable. */
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION ?? "&copy; OpenStreetMap contributors";
/** Cikarang industrial area: a sensible start when a route has no coordinates yet. */
const DEFAULT_CENTER: LatLng = { lat: -6.3, lng: 107.15 };

const pin = (label: string, color: string, current: boolean) => {
  const el = document.createElement("span");
  el.className = `map-pin${current ? " current" : ""}`;
  el.style.setProperty("--c", color);
  el.textContent = label;
  return L.divIcon({ className: "", html: el, iconSize: [28, 28], iconAnchor: [14, 14] });
};
const valid = (lat: number | null, lng: number | null): boolean => lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Leaflet owns its DOM, so React only feeds it data. `draft` is the stop being edited:
 * clicking the map or dragging its pin reports a new position through `onPick`.
 */
export function RouteMap({ stops, color, draft, onPick }: {
  stops: MapStop[]; color: string; draft?: { id: string; lat: number | null; lng: number | null }; onPick?(p: LatLng): void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const layer = useRef<L.LayerGroup>();
  const pick = useRef(onPick);
  pick.current = onPick;
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], zoom: 12 });
    if (TILE_URL) {
      const tiles = L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 });
      tiles.on("tileerror", () => setTilesFailed(true));
      tiles.addTo(m);
    }
    m.on("click", (e: L.LeafletMouseEvent) => pick.current?.({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = undefined; };
  }, []);

  const placed = stops.filter((s) => valid(s.lat, s.lng)).sort((a, b) => a.seq - b.seq);
  const draftPos = draft && valid(draft.lat, draft.lng) ? { lat: draft.lat!, lng: draft.lng! } : null;
  const key = JSON.stringify([placed, draftPos, draft?.id, color]);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const points: L.LatLngExpression[] = [];
    for (const s of placed) {
      // The stop being edited is drawn at its draft position, not its saved one.
      const editing = draft?.id === s.id;
      const pos = editing && draftPos ? draftPos : { lat: s.lat!, lng: s.lng! };
      points.push([pos.lat, pos.lng]);
      const mk = L.marker([pos.lat, pos.lng], { icon: pin(String(s.seq), s.active ? color : "#8C98A6", editing), draggable: editing, title: `${s.seq}. ${s.name}` });
      const tip = document.createElement("span");
      tip.textContent = `${s.seq}. ${s.name}${s.active ? "" : " (nonaktif)"}`;
      mk.bindTooltip(tip);
      if (editing) mk.on("dragend", () => { const p = mk.getLatLng(); pick.current?.({ lat: round(p.lat), lng: round(p.lng) }); });
      mk.addTo(g);
    }
    if (draft && !draft.id && draftPos) {
      const mk = L.marker([draftPos.lat, draftPos.lng], { icon: pin("+", color, true), draggable: true, title: "Titik baru" });
      mk.on("dragend", () => { const p = mk.getLatLng(); pick.current?.({ lat: round(p.lat), lng: round(p.lng) }); });
      mk.addTo(g);
      points.push([draftPos.lat, draftPos.lng]);
    }
    const line = placed.map((s) => (draft?.id === s.id && draftPos ? [draftPos.lat, draftPos.lng] : [s.lat!, s.lng!]) as L.LatLngTuple);
    if (line.length > 1) L.polyline(line, { color, weight: 4, opacity: .75, dashArray: "8 8" }).addTo(g);
    if (points.length > 0) m.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
  }, [key]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" role="application" aria-label="Peta titik jemput" />
      <p className="map-note">
        {onPick ? "Klik peta atau geser pin untuk menentukan lokasi titik. " : ""}
        Garis putus-putus menghubungkan titik sesuai urutan, bukan jalur jalan sebenarnya.
        {tilesFailed && " Peta dasar gagal dimuat; koordinat tetap bisa diisi manual."}
      </p>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
