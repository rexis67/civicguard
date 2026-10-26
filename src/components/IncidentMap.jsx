import { useEffect, useRef, useState } from "react";
import L from "leaflet";

const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABEL_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
const DEFAULT_CENTER = [12.9716, 77.5946];
const DEFAULT_ZOOM = 12;

const URGENCY_COLORS = {
  critical: "#ff6b7a",
  high: "#f5b942",
  medium: "#4cd7f6",
  low: "#4edea3",
};

function markerIcon(urgency) {
  const color = URGENCY_COLORS[String(urgency ?? "").toLowerCase()] ?? URGENCY_COLORS.medium;

  return L.divIcon({
    className: "civic-map-marker",
    html: `<span style="--marker-color:${color}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
}

function addTileLayer(map) {
  const tileOptions = {
    maxZoom: 19,
    maxNativeZoom: 16,
  };

  L.tileLayer(TILE_URL, {
    ...tileOptions,
    attribution: TILE_ATTRIBUTION,
  }).addTo(map);

  // Labels are a separate transparent layer on Esri's dark canvas basemap.
  L.tileLayer(LABEL_TILE_URL, tileOptions).addTo(map);
}

function makePopup(report) {
  const popup = document.createElement("div");
  popup.className = "civic-map-popup";

  const title = document.createElement("strong");
  title.textContent = report.title;

  const meta = document.createElement("span");
  meta.textContent = [report.category, report.district, report.status]
    .filter(Boolean)
    .join(" · ");

  const id = document.createElement("span");
  id.className = "civic-map-popup-id";
  id.textContent = `#${String(report.id ?? "").slice(0, 8).toUpperCase()} · ${report.urgency ?? "medium"} urgency`;

  popup.append(title, meta, id);
  return popup;
}

/**
 * Read-only incident map. Reports without a location are skipped; the feed
 * below remains the accessible, text-equivalent view.
 */
export function IncidentMap({ reports, height = 380, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const fittedRef = useRef(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: false,
    });
    addTileLayer(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // The tab panel can mount while hidden; recalculate once it is visible.
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  // Rebuild only when the mapped data actually changes, not on every 5s poll.
  const signature = reports
    .map((report) => `${report.id}:${report.lat}:${report.lng}:${report.urgency}:${report.status}`)
    .join("|");

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const points = [];

    for (const report of reports) {
      if (!Number.isFinite(report.lat) || !Number.isFinite(report.lng)) continue;

      const point = [report.lat, report.lng];
      points.push(point);

      const marker = L.marker(point, {
        icon: markerIcon(report.urgency),
        title: report.title,
        alt: `${report.title} on the incident map`,
        keyboard: true,
      });
      marker.bindPopup(makePopup(report));
      marker.on("click", () => onSelectRef.current?.(report.id));
      marker.addTo(layer);
    }

    if (points.length === 1) {
      map.setView(points[0], 14);
      fittedRef.current = true;
    } else if (points.length > 1 && !fittedRef.current) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
      fittedRef.current = true;
    }
    // `signature` is the stable dependency; `reports` changes every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <div
      aria-label="Map of reported incidents. Use the incident list below for a text version."
      className="civic-map"
      ref={containerRef}
      role="application"
      style={{ height }}
    />
  );
}

/**
 * Map picker used by the citizen report form. Clicking the map or dragging the
 * pin sets the coordinates; geolocation is optional and requires HTTPS.
 */
export function LocationPicker({ value, onChange, height = 240 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const [geoStatus, setGeoStatus] = useState("");
  const [geoError, setGeoError] = useState("");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const map = L.map(containerRef.current, {
      center: value ?? DEFAULT_CENTER,
      zoom: value ? 14 : DEFAULT_ZOOM,
      scrollWheelZoom: false,
    });
    addTileLayer(map);
    map.on("click", (event) => {
      onChangeRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    });
    mapRef.current = map;

    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // The picker is intentionally initialized once; later value changes are
    // handled by the marker effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const point = [value.lat, value.lng];
    if (!markerRef.current) {
      markerRef.current = L.marker(point, {
        draggable: true,
        icon: markerIcon("medium"),
        title: "Selected incident location",
      }).addTo(map);
      markerRef.current.on("dragend", () => {
        const latlng = markerRef.current.getLatLng();
        onChangeRef.current?.({ lat: latlng.lat, lng: latlng.lng });
      });
    } else {
      markerRef.current.setLatLng(point);
    }

    map.setView(point, Math.max(map.getZoom(), 14));
  }, [value]);

  function handleLocate() {
    setGeoError("");
    setGeoStatus("");

    if (!navigator.geolocation) {
      setGeoError("This browser does not support geolocation. Click the map to place the pin instead.");
      return;
    }

    setGeoStatus("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChangeRef.current?.({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setGeoStatus(
          `Location captured (accuracy about ${Math.max(1, Math.round(position.coords.accuracy))} m). Drag the pin to adjust.`,
        );
      },
      (error) => {
        setGeoStatus("");
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Click the map to place the pin instead."
            : "Could not get your location. Click the map to place the pin instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-deep/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-wider text-muted">
          Pin the issue{" "}
          <span className="normal-case tracking-normal text-muted/60">(optional)</span>
        </p>
        <div className="flex gap-2">
          <button
            className="rounded border border-cyan/30 bg-cyan/10 px-2.5 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-cyan transition hover:bg-cyan/15 focus:outline-none focus:ring-2 focus:ring-cyan/30"
            onClick={handleLocate}
            type="button"
          >
            Use my location
          </button>
          {value && (
            <button
              className="rounded border border-white/10 bg-panel-raised px-2.5 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted transition hover:border-alert/30 hover:text-alert focus:outline-none focus:ring-2 focus:ring-cyan/30"
              onClick={() => {
                onChangeRef.current?.(null);
                setGeoStatus("");
                setGeoError("");
              }}
              type="button"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
        <div
          aria-label="Click the map to set the incident location"
          className="civic-map"
          ref={containerRef}
          role="application"
          style={{ height }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[9px]">
        <p className={geoError ? "text-amber-300" : "text-muted/70"}>
          {geoError || geoStatus || "Click the map or drag the pin to place the incident."}
        </p>
        {value && (
          <p className="text-cyan">
            Lat {value.lat.toFixed(5)} · Lng {value.lng.toFixed(5)}
          </p>
        )}
      </div>
      <p className="mt-1 font-mono text-[9px] leading-4 text-muted/50">
        The pin is public. Use a nearby intersection if you prefer not to share an
        exact address.
      </p>
    </div>
  );
}
