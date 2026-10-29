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

const pin = (label: string, color: string, current: boolean, movable: boolean) => {
  const el = document.createElement("span");
  el.className = `map-pin${current ? " current" : ""}${movable ? " movable" : ""}`;
  el.style.setProperty("--c", color);
  el.textContent = label;
  return L.divIcon({ className: "", html: el, iconSize: [28, 28], iconAnchor: [14, 14] });
};
const valid = (lat: number | null, lng: number | null): boolean => lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Leaflet owns its DOM, so React only feeds it data.
 * - a basemap click reports a position for the stop in the form (`onPick`)
 * - dragging a saved, active pin reports its stop id and new position (`onMove`)
 * - clicking a pin asks the page to open that stop in the form (`onSelect`)
 * The map only re-fits when the set of shown stops changes, so a drag does not yank the view back.
 */
export function RouteMap({ stops, color, draft, onPick, onMove, onSelect, showInactive = false, redraw = 0, readOnly = false, compact = false, label = "Peta titik jemput" }: {
  stops: MapStop[]; color: string; draft?: { id: string; lat: number | null; lng: number | null };
  onPick?(p: LatLng): void; onMove?(stopId: string, p: LatLng): void; onSelect?(stopId: string): void;
  showInactive?: boolean; redraw?: number; readOnly?: boolean; compact?: boolean; label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const layer = useRef<L.LayerGroup>();
  const pick = useRef(onPick);
  pick.current = onPick;
  const move = useRef(onMove);
  move.current = onMove;
  const select = useRef(onSelect);
  select.current = onSelect;
  const fitted = useRef("");
  const [fitTick, setFitTick] = useState(0);
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
  // The stop in the form stays on the map even when its row is inactive and inactive rows are hidden.
  const shown = placed.filter((s) => showInactive || s.active || s.id === draft?.id);
  const draftPos = draft && valid(draft.lat, draft.lng) ? { lat: draft.lat!, lng: draft.lng! } : null;
  const key = JSON.stringify([shown, draftPos, draft?.id, color, redraw, fitTick, readOnly]);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const points: L.LatLngExpression[] = [];
    for (const s of shown) {
      // The stop being edited is drawn at its draft position, not its saved one.
      const editing = draft?.id === s.id;
      const pos = editing && draftPos ? draftPos : { lat: s.lat!, lng: s.lng! };
      points.push([pos.lat, pos.lng]);
      const mk = L.marker([pos.lat, pos.lng], {
        icon: pin(String(s.seq), s.active ? color : "#8C98A6", editing, s.active && !readOnly),
        draggable: !readOnly && s.active,
        title: `${s.seq}. ${s.name}`,
        interactive: !readOnly,
      });
      const tip = document.createElement("span");
      tip.textContent = `${s.seq}. ${s.name}${s.active ? "" : " (nonaktif)"}`;
      mk.bindTooltip(tip);
      mk.on("click", () => select.current?.(s.id));
      if (!readOnly && s.active) mk.on("dragend", () => {
        const p = mk.getLatLng();
        const at = { lat: round(p.lat), lng: round(p.lng) };
        // An edited stop belongs to the form until Simpan; every other pin saves on drop.
        if (editing) pick.current?.(at); else move.current?.(s.id, at);
      });
      mk.addTo(g);
    }
    if (draft && !draft.id && draftPos) {
      const mk = L.marker([draftPos.lat, draftPos.lng], { icon: pin("+", color, true, true), draggable: true, title: "Titik baru" });
      mk.on("dragend", () => { const p = mk.getLatLng(); pick.current?.({ lat: round(p.lat), lng: round(p.lng) }); });
      mk.addTo(g);
      points.push([draftPos.lat, draftPos.lng]);
    }
    // Only active stops are part of the route line: a deactivated stop is no longer served.
    const line = shown.filter((s) => s.active).map((s) => (draft?.id === s.id && draftPos ? [draftPos.lat, draftPos.lng] : [s.lat!, s.lng!]) as L.LatLngTuple);
    if (line.length > 1) L.polyline(line, { color, weight: 4, opacity: .75, dashArray: "8 8", interactive: !readOnly }).addTo(g);
    const ids = shown.map((s) => s.id).join(",");
    if (points.length > 0 && (ids !== fitted.current || fitTick > 0)) {
      fitted.current = ids;
      if (fitTick > 0) setFitTick(0);
      m.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    }
  }, [key]);

  const movable = !!onMove;
  const placedIds = new Set(placed.map((s) => s.id));
  const unplaced = stops.filter((s) => s.active && !placedIds.has(s.id)).sort((a, b) => a.seq - b.seq);
  return (
    <div className={`map-wrap${compact ? " route-map-compact" : ""}`}>
      <div ref={el} className="map" role={readOnly ? "img" : "application"} aria-label={label} />
      {readOnly && stops.length > 0 && (
        <ol className="route-stop-list" aria-label="Urutan titik jemput">
          {stops.filter((s) => s.active).sort((a, b) => a.seq - b.seq).map((s) => (
            <li key={s.id}>
              <span className="route-stop-number" style={{ background: color }}>{s.seq}</span>
              <span>{s.name}</span>
              {!valid(s.lat, s.lng) && <small>lokasi belum tersedia</small>}
            </li>
          ))}
        </ol>
      )}
      <div className="map-foot">
        <p className="map-note">
          {onPick ? "Klik peta atau geser pin untuk menentukan lokasi titik. " : ""}
          {movable ? "Menyeret pin titik yang sudah tersimpan langsung menyimpan posisi barunya; klik pin untuk mengubah data titik. " : ""}
          {readOnly ? "Garis putus-putus menunjukkan urutan titik, bukan jalur jalan sebenarnya." : "Garis putus-putus menghubungkan titik aktif sesuai urutan, bukan jalur jalan sebenarnya."}
          {unplaced.length > 0 && ` ${unplaced.length} titik aktif belum memiliki koordinat dan tidak dapat ditampilkan di peta.`}
          {tilesFailed && " Peta dasar gagal dimuat; koordinat tetap bisa diisi manual."}
        </p>
        {!compact && <button type="button" onClick={() => setFitTick((n) => n + 1)}>Tampilkan semua titik</button>}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
