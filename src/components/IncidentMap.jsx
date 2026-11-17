import { memo, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { HeatLayer } from "leaflet.heat";
import { useTheme } from "../context/ThemeContext.jsx";
import { reportFormLabels } from "../i18n/reportForm.js";
import { hasConfirmedReport } from "../services/deviceIdentity.js";
import cityConfig from "../../config/city.json";

const DEFAULT_CENTER = cityConfig.mapCenter;
const DEFAULT_ZOOM = 12;
// Esri's public raster tiles are keyless, stable and match the map used by
// the original CivicGuard deployment. CARTO's anonymous raster tiles now show
// "API KEY REQUIRED" watermarks, so they are intentionally not used here.
const ESRI_DARK_BASE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const ESRI_DARK_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const ESRI_LIGHT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const EMPTY_REPORTS = [];
const MARKER_ICONS = new Map();

const URGENCY_COLORS = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#10b981",
};

function isDarkMode() {
  return document.documentElement.classList.contains("dark");
}

function markerLabel(report) {
  return `${report.title || "Incident"}, ${report.category || "Incident"}, ${report.urgency || "medium"} urgency`;
}

function markerSvg(urgency, selected = false) {
  const color =
    URGENCY_COLORS[String(urgency ?? "medium").toLowerCase()] ??
    URGENCY_COLORS.medium;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">
      <ellipse cx="14" cy="31.5" rx="5.5" ry="1.8" fill="#000000" opacity="0.28" />
      <path d="M14 1.5C8.5 1.5 4 5.9 4 11.4c0 7.3 10 20.8 10 20.8s10-13.5 10-20.8C24 5.9 19.5 1.5 14 1.5Z" fill="${color}" />
      <circle cx="14" cy="11.5" r="${selected ? 6.3 : 5.5}" fill="#ffffff" />
      <circle cx="14" cy="11.5" r="${selected ? 3.2 : 2.7}" fill="${color}" />
    </svg>
  `;
}

function mapMarker(urgency, selected = false) {
  const normalizedUrgency = String(urgency ?? "medium").toLowerCase();
  const key = `${normalizedUrgency}:${selected}`;
  if (MARKER_ICONS.has(key)) return MARKER_ICONS.get(key);

  const icon = L.divIcon({
    className: "civic-marker",
    html: `<button type="button" class="civic-marker-button${selected ? " is-selected" : ""}" aria-label="Incident marker">${markerSvg(normalizedUrgency, selected)}</button>`,
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    popupAnchor: [0, -32],
  });
  // Reuse static icon DOM so routine feed refreshes do not recreate markers.
  MARKER_ICONS.set(key, icon);
  return icon;
}

function updateMarkerAccessibility(marker, label) {
  marker.options.title = label;
  marker.options.alt = label;
  const element = marker.getElement()?.querySelector(".civic-marker-button");
  if (
    !element ||
    (element.getAttribute("aria-label") === label && element.title === label)
  ) return;
  element.setAttribute("aria-label", label);
  element.setAttribute("title", label);
}

function observeMapSize(map, element) {
  let frame = 0;
  // Batch layout invalidations to one frame during container resizing.
  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  });
  resizeObserver.observe(element);
  frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  return () => {
    resizeObserver.disconnect();
    cancelAnimationFrame(frame);
  };
}

function createTileLayers(dark) {
  const options = {
    attribution: ESRI_ATTRIBUTION,
    maxZoom: 19,
    // Avoid zoom-time tile churn and retain nearby tiles for smoother pans.
    updateWhenIdle: L.Browser.mobile,
    updateWhenZooming: false,
    keepBuffer: 4,
  };

  if (!dark) {
    return [L.tileLayer(ESRI_LIGHT, options)];
  }

  // Esri splits its dark basemap into a label-free base and a transparent
  // label overlay. Add both so places stay readable in dark mode.
  return [
    L.tileLayer(ESRI_DARK_BASE, options),
    L.tileLayer(ESRI_DARK_LABELS, { ...options, attribution: "" }),
  ];
}

function makePopup(report, onSelect, onConfirm) {
  const el = document.createElement("div");
  el.className = "civic-popup";

  const title = document.createElement("div");
  title.className = "civic-popup-title";
  title.textContent = report.title || "Incident";

  const meta = document.createElement("div");
  meta.className = "civic-popup-meta";
  meta.textContent = [report.category, report.district].filter(Boolean).join(" · ");

  const count = document.createElement("div");
  count.className = "civic-popup-meta civic-popup-count";
  count.textContent = onConfirm
    ? `${Number(report.confirmationCount) || 0} people confirmed this`
    : `${Number(report.reportCount) || 1} reports in this area`;
  el.append(title, meta, count);

  if (onConfirm) {
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "civic-popup-button civic-popup-secondary-button";
    const alreadyConfirmed = hasConfirmedReport(report.id);
    confirmButton.textContent = alreadyConfirmed ? "You see this too" : "I see this too";
    confirmButton.disabled = alreadyConfirmed;
    confirmButton.onclick = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      confirmButton.disabled = true;
      confirmButton.textContent = "Saving…";
      try {
        const result = await onConfirm(report.id);
        count.textContent = `${result?.confirmationCount ?? report.confirmationCount ?? 0} people confirmed this`;
        confirmButton.textContent = "You see this too";
      } catch (error) {
        confirmButton.disabled = false;
        confirmButton.textContent = "Try again";
        console.error("Could not save report confirmation:", error);
      }
    };
    el.append(confirmButton);
  }

  if (onSelect) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "civic-popup-button";
    btn.textContent = "View report";
    btn.setAttribute("aria-label", `View report: ${report.title || "Incident"}`);
    btn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      onSelect(report.id);
    };

    el.append(btn);
  }
  return el;
}

/* ---------------------------------------------------------------- */
/* IncidentMap                                                      */
/* ---------------------------------------------------------------- */
function IncidentMapComponent({ reports = EMPTY_REPORTS, height = 380, onSelect, onConfirm, darkMode }) {
  const [tileError, setTileError] = useState(false);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapCreatedRef = useRef(false);
  const clusterRef = useRef(null);
  const heatLayerRef = useRef(null);
  const heatmapEnabledRef = useRef(false);
  const tileLayersRef = useRef([]);
  const tileModeRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const onConfirmRef = useRef(onConfirm);
  const fittedRef = useRef(false);
  const selectedMarkerRef = useRef(null);
  const tileErrorLoggedRef = useRef(false);
  const prevSignatureRef = useRef(null);
  const markersRef = useRef(new Map());
  const markerSignaturesRef = useRef(new Map());
  const resolvedDark = darkMode ?? isDarkMode();
  const darkModeRef = useRef(resolvedDark);
  darkModeRef.current = resolvedDark;
  // Reuse report lookups and marker signatures between stable feed renders.
  const reportsById = useMemo(
    () => new Map(
      reports
        .filter((report) => report?.id !== null && report?.id !== undefined)
        .map((report) => [String(report.id), report]),
    ),
    [reports],
  );
  const reportsByIdRef = useRef(reportsById);
  reportsByIdRef.current = reportsById;
  const signature = useMemo(
    () => JSON.stringify(
      reports
        .map((report) => [
          report?.id,
          report?.lat,
          report?.lng,
          report?.urgency,
          report?.title,
          report?.category,
          report?.reportCount,
        ])
        .sort((first, second) =>
          String(first[0] ?? "").localeCompare(String(second[0] ?? "")),
        ),
    ),
    [reports],
  );
  const tileErrorRef = useRef(false);
  const setTileErrorIfChanged = (next) => {
    if (tileErrorRef.current === next) return;
    tileErrorRef.current = next;
    setTileError(next);
  };
  const watchTileLayers = (layers) => {
    layers.forEach((layer, index) => {
      // Only the base layer controls the error banner. The transparent label
      // overlay may occasionally miss a tile without breaking the map.
      layer
        .on("tileerror", (event) => {
          if (index !== 0) return;
          if (!tileErrorLoggedRef.current) {
            console.warn("CivicGuard map tiles could not be loaded:", event.error);
            tileErrorLoggedRef.current = true;
          }
          setTileErrorIfChanged(true);
        })
        .on("tileload", () => {
          if (index !== 0) return;
          tileErrorLoggedRef.current = false;
          setTileErrorIfChanged(false);
        });
    });
    return layers;
  };

  const replaceTileLayers = (dark) => {
    const map = mapRef.current;
    if (!map) return;
    tileLayersRef.current.forEach((layer) => layer.remove());
    tileLayersRef.current = watchTileLayers(createTileLayers(dark))
      .map((layer) => layer.addTo(map));
    tileModeRef.current = dark;
    setTileErrorIfChanged(false);
  };

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  useEffect(() => {
    if (!containerRef.current || mapCreatedRef.current) return undefined;
    mapCreatedRef.current = true;
    let map;
    let resizeCleanup;

    try {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      map = L.map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        scrollWheelZoom: false,
        zoomControl: false,
        attributionControl: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: false,
        zoomAnimation: !reduceMotion,
        fadeAnimation: !reduceMotion,
        markerZoomAnimation: !reduceMotion,
      });
      map.attributionControl.setPosition("bottomleft");
      mapRef.current = map;

      replaceTileLayers(darkModeRef.current);

      resizeCleanup = observeMapSize(map, containerRef.current);

      clusterRef.current = L.markerClusterGroup({
        spiderfyOnMaxZoom: false,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 16,
        maxClusterRadius: 50,
        animate: !reduceMotion,
        // Avoid per-marker entrance animations when refreshed reports are added.
        animateAddingMarkers: false,
        chunkedLoading: true,
        chunkInterval: 200,
        iconCreateFunction: (cluster) => {
          const counts = { critical: 0, high: 0, medium: 0, low: 0 };
          cluster.getAllChildMarkers().forEach((marker) => {
            const urgency = String(marker.options.urgency || "medium").toLowerCase();
            counts[urgency in counts ? urgency : "medium"] += 1;
          });
          const urgency = Object.keys(counts).reduce((dominant, current) =>
            counts[current] > counts[dominant] ? current : dominant,
          "low");
          return L.divIcon({
            className: `civic-cluster civic-cluster-${urgency}`,
            html: `<span aria-label="${cluster.getChildCount()} incidents">${cluster.getChildCount()}</span>`,
            iconSize: [42, 42],
          });
        },
      }).addTo(map);

      heatLayerRef.current = new HeatLayer([], {
        radius: 26,
        blur: 20,
        maxZoom: 16,
        gradient: { 0.2: "#22c55e", 0.5: "#facc15", 0.8: "#f97316", 1: "#dc2626" },
      });
      const heatControl = L.control({ position: "topleft" });
      heatControl.onAdd = () => {
        const button = L.DomUtil.create("button", "civic-map-heat-toggle");
        button.type = "button";
        button.textContent = "Heatmap";
        button.setAttribute("aria-label", "Show incident hotspot heatmap");
        button.setAttribute("aria-pressed", "false");
        L.DomEvent.disableClickPropagation(button);
        L.DomEvent.disableScrollPropagation(button);
        L.DomEvent.on(button, "click", () => {
          heatmapEnabledRef.current = !heatmapEnabledRef.current;
          if (heatmapEnabledRef.current) heatLayerRef.current?.addTo(map);
          else heatLayerRef.current?.remove();
          button.setAttribute("aria-pressed", String(heatmapEnabledRef.current));
          button.setAttribute(
            "aria-label",
            heatmapEnabledRef.current
              ? "Hide incident hotspot heatmap"
              : "Show incident hotspot heatmap",
          );
        });
        return button;
      };
      map.addControl(heatControl);

      const control = L.control({ position: "bottomright" });
      control.onAdd = () => {
        const element = L.DomUtil.create("div", "civic-map-controls");
        element.setAttribute("role", "group");
        element.setAttribute("aria-label", "Map zoom controls");
        element.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 5px;
          background: var(--civic-surface);
          color: var(--civic-text);
          border: 1px solid var(--civic-border);
          border-radius: 999px;
          padding: 5px;
          box-shadow: var(--civic-shadow);
          font-family: system-ui, -apple-system, sans-serif;
        `;
        L.DomEvent.disableClickPropagation(element);
        L.DomEvent.disableScrollPropagation(element);

        const makeButton = (label, ariaLabel, zoom) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.setAttribute("aria-label", ariaLabel);
          button.style.cssText = `
            display: grid;
            place-items: center;
            width: 36px;
            height: 36px;
            border: 1px solid var(--civic-border);
            border-radius: 50%;
            background: var(--civic-surface);
            color: var(--civic-text);
            cursor: pointer;
            font-size: 19px;
            line-height: 1;
          `;
          button.addEventListener("click", () => {
            if (zoom > 0) map.zoomIn();
            else map.zoomOut();
          });
          return button;
        };

        element.append(
          makeButton("+", "Zoom in on the incident map", 1),
          makeButton("−", "Zoom out on the incident map", -1),
        );

        const recenterButton = document.createElement("button");
        recenterButton.type = "button";
        recenterButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>`;
        recenterButton.setAttribute("aria-label", "Recenter incident map to city center");
        recenterButton.style.cssText = `
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          border: 1px solid var(--civic-border);
          border-radius: 50%;
          background: var(--civic-surface);
          color: var(--civic-text);
          cursor: pointer;
        `;
        recenterButton.addEventListener("click", () => {
          map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 0.8 });
        });
        element.append(recenterButton);
        return element;
      };
      map.addControl(control);

    } catch (error) {
      console.error("CivicGuard incident map could not be initialized:", error);
      resizeCleanup?.();
      map?.stop();
      map?.remove();
      mapRef.current = null;
      clusterRef.current = null;
      heatLayerRef.current = null;
      tileLayersRef.current = [];
      tileModeRef.current = null;
      mapCreatedRef.current = false;
      return undefined;
    }

    return () => {
      resizeCleanup?.();
      map?.stop();
      map?.remove();
      mapRef.current = null;
      mapCreatedRef.current = false;
      heatmapEnabledRef.current = false;
      clusterRef.current = null;
      heatLayerRef.current = null;
      tileLayersRef.current = [];
      tileModeRef.current = null;
      fittedRef.current = false;
      prevSignatureRef.current = null;
      markersRef.current.clear();
      markerSignaturesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || tileModeRef.current === resolvedDark) return;
    replaceTileLayers(resolvedDark);
  }, [resolvedDark]);

  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;

    if (signature === prevSignatureRef.current) return;

    const incomingIds = new Set();
    const points = [];
    const heatPoints = [];
    const markersToAdd = [];

    for (const report of reportsById.values()) {
      if (
        report?.id === null ||
        report?.id === undefined ||
        typeof report.lat !== "number" ||
        typeof report.lng !== "number" ||
        !Number.isFinite(report.lat) ||
        !Number.isFinite(report.lng)
      ) continue;

      const id = String(report.id);
      incomingIds.add(id);
      const point = [report.lat, report.lng];
      points.push(point);
      heatPoints.push([
        report.lat,
        report.lng,
        Math.min(1, Math.max(0.2, (Number(report.reportCount) || 1) / 5)),
      ]);
      const markerSignature = JSON.stringify([
        report.lat,
        report.lng,
        report.urgency,
        report.title,
        report.category,
        report.reportCount,
      ]);
      let marker = markersRef.current.get(id);

      if (!marker) {
        marker = L.marker(point, {
          icon: mapMarker(report.urgency),
          urgency: String(report.urgency || "medium").toLowerCase(),
          title: markerLabel(report),
          alt: markerLabel(report),
          keyboard: false,
          // Panning over dense markers should not trigger rise animations.
          riseOnHover: false,
        });
        marker.bindPopup(() => {
          const latestReport = reportsByIdRef.current.get(id) ?? report;
          return makePopup(
            latestReport,
            (reportId) => onSelectRef.current?.(reportId),
            (reportId) => onConfirmRef.current?.(reportId),
          );
        });
        marker.on("click", () => {
          const latestReport = reportsByIdRef.current.get(id) ?? report;
          const previousSelected = selectedMarkerRef.current;
          if (previousSelected && previousSelected !== marker) {
            previousSelected.setIcon(mapMarker(previousSelected.options.urgency));
            updateMarkerAccessibility(
              previousSelected,
              previousSelected.options.alt,
            );
          }
          selectedMarkerRef.current = marker;
          marker.setIcon(mapMarker(marker.options.urgency, true));
          updateMarkerAccessibility(marker, markerLabel(latestReport));
          onSelectRef.current?.(latestReport.id);
        });
        marker.on("add", () => {
          updateMarkerAccessibility(
            marker,
            marker.options.alt ?? marker.options.title,
          );
        });
        markersRef.current.set(id, marker);
        markerSignaturesRef.current.set(id, markerSignature);
        markersToAdd.push(marker);
      } else if (markerSignaturesRef.current.get(id) !== markerSignature) {
        const currentPoint = marker.getLatLng();
        const previousSignature = JSON.parse(
          markerSignaturesRef.current.get(id),
        );
        if (currentPoint.lat !== report.lat || currentPoint.lng !== report.lng) {
          marker.setLatLng(point);
        }
        if (previousSignature[2] !== report.urgency) {
          marker.options.urgency = String(report.urgency || "medium").toLowerCase();
          marker.setIcon(mapMarker(report.urgency, marker === selectedMarkerRef.current));
          cluster.refreshClusters(marker);
        }
        markerSignaturesRef.current.set(id, markerSignature);
      }

      const label = markerLabel(report);
      marker.options.urgency = String(report.urgency || "medium").toLowerCase();
      updateMarkerAccessibility(marker, label);
    }

    for (const [id, marker] of markersRef.current.entries()) {
      if (!incomingIds.has(id)) {
        cluster.removeLayer(marker);
        if (selectedMarkerRef.current === marker) selectedMarkerRef.current = null;
        markersRef.current.delete(id);
        markerSignaturesRef.current.delete(id);
      }
    }

    if (markersToAdd.length > 0) cluster.addLayers(markersToAdd);
    heatLayerRef.current?.setLatLngs(heatPoints);

    if (!fittedRef.current && points.length > 0) {
      if (points.length === 1) {
        map.setView(points[0], 14, { animate: false });
      } else {
        map.fitBounds(points, {
          padding: [44, 44],
          maxZoom: 16,
          animate: false,
        });
      }
      fittedRef.current = true;
    }
    prevSignatureRef.current = signature;
  }, [signature]);

  return (
    <div
      className="civic-map"
      style={{
        height,
        width: "100%",
        position: "relative",
        background: "var(--civic-bg)",
      }}
    >
      <div
        ref={containerRef}
        aria-label="Map of reported incidents"
        className="civic-map-canvas"
        role="application"
      />
      {tileError && (
        <div className="civic-map-error" role="status">
          <span>Map tiles could not be loaded.</span>
          <button
            onClick={() => {
              setTileErrorIfChanged(false);
              tileLayersRef.current.forEach((layer) => layer.redraw());
            }}
            type="button"
          >
            Retry map
          </button>
        </div>
      )}
    </div>
  );
}

// Skip React work when map inputs are referentially stable.
export const IncidentMap = memo(IncidentMapComponent);

/* ---------------------------------------------------------------- */
/* LocationPicker (preserved from original)                         */
/* ---------------------------------------------------------------- */
const BENGALURU_LANDMARKS = [
  { name: "Central / MG Road", lat: 12.9756, lng: 77.6097 },
  { name: "Indiranagar", lat: 12.9784, lng: 77.6408 },
  { name: "Koramangala", lat: 12.9352, lng: 77.6245 },
  { name: "Whitefield", lat: 12.9698, lng: 77.7500 },
  { name: "Jayanagar", lat: 12.9308, lng: 77.5838 },
  { name: "HSR Layout", lat: 12.9121, lng: 77.6446 },
  { name: "Malleshwaram", lat: 13.0031, lng: 77.5643 },
  { name: "Electronic City", lat: 12.8452, lng: 77.6602 },
  { name: "Hebbal", lat: 13.0358, lng: 77.5970 },
];

export function LocationPicker({ value, onChange, height = 240, language = "en" }) {
  const { darkMode } = useTheme();
  const labels = reportFormLabels[language] ?? reportFormLabels.en;
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const tileLayersRef = useRef([]);
  const tileModeRef = useRef(darkMode);
  const onChangeRef = useRef(onChange);
  const [searchQuery, setSearchQuery] = useState("");

  const replaceTileLayers = (dark) => {
    const map = mapRef.current;
    if (!map) return;
    tileLayersRef.current.forEach((layer) => layer.remove());
    tileLayersRef.current = createTileLayers(dark).map((layer) => layer.addTo(map));
    tileModeRef.current = dark;
  };

  const handleSelectLandmark = (landmark) => {
    if (!landmark) return;
    onChangeRef.current?.({ lat: landmark.lat, lng: landmark.lng });
    mapRef.current?.flyTo([landmark.lat, landmark.lng], 15, { duration: 0.6 });
  };

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const map = L.map(containerRef.current, {
      center: value ? [value.lat, value.lng] : DEFAULT_CENTER,
      zoom: value ? 15 : DEFAULT_ZOOM,
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
      zoomAnimation: !reduceMotion,
      fadeAnimation: !reduceMotion,
      markerZoomAnimation: !reduceMotion,
    });
    map.attributionControl.setPosition("bottomleft");
    mapRef.current = map;
    replaceTileLayers(tileModeRef.current);

    map.on("click", (event) => {
      onChangeRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    });
    const cleanupResizeObserver = observeMapSize(map, containerRef.current);
    return () => {
      cleanupResizeObserver();
      map.stop();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      tileLayersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || tileModeRef.current === darkMode) return;
    replaceTileLayers(darkMode);
  }, [darkMode]);

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
        icon: mapMarker("medium"),
        title: "Selected incident location",
      }).addTo(map);
      markerRef.current.on("dragend", () => {
        const latlng = markerRef.current.getLatLng();
        onChangeRef.current?.({ lat: latlng.lat, lng: latlng.lng });
      });
    } else {
      markerRef.current.setLatLng(point);
    }

    if (map.getZoom() < 14 || !map.getBounds().contains(point)) {
      map.setView(point, Math.max(map.getZoom(), 14), { animate: false });
    }
  }, [value]);

  return (
    <div className="rounded-lg border border-line bg-deep/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-wider text-muted">
          {labels.location}{" "}
          <span className="normal-case tracking-normal text-muted/60">
            ({labels.locationOptional})
          </span>
        </p>
        <div className="flex gap-2">
          <button
            className="rounded border border-cyan/30 bg-cyan/10 px-2.5 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-cyan transition hover:bg-cyan/15 focus:outline-none focus:ring-2 focus:ring-cyan/30"
            onClick={() => {
              if (!navigator.geolocation) return;
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  onChangeRef.current?.({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                  });
                },
                () => {},
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
              );
            }}
            type="button"
          >
            {labels.useLocation}
          </button>
          {value && (
            <button
              className="rounded border border-line bg-panel-raised px-2.5 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted transition hover:border-alert/30 hover:text-alert focus:outline-none focus:ring-2 focus:ring-cyan/30"
              onClick={() => {
                onChangeRef.current?.(null);
              }}
              type="button"
            >
              {labels.clear}
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <label className="sr-only" htmlFor="landmark-quick-picker">Quick jump to neighborhood</label>
        <select
          id="landmark-quick-picker"
          className="min-h-9 min-w-0 flex-1 rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[10px] text-ink outline-none transition focus:border-brand focus:ring-1 focus:ring-brand"
          onChange={(e) => {
            const found = BENGALURU_LANDMARKS.find((lm) => lm.name === e.target.value);
            if (found) handleSelectLandmark(found);
          }}
          defaultValue=""
        >
          <option value="" disabled>Choose a neighborhood…</option>
          {BENGALURU_LANDMARKS.map((lm) => (
            <option key={lm.name} value={lm.name}>{lm.name}</option>
          ))}
        </select>
      </div>

      <div className="civic-map-frame mt-3 overflow-hidden rounded-lg border border-line">
        <div
          aria-label="Click the map to set the incident location"
          className="civic-map"
          ref={containerRef}
          role="application"
          style={{ height, isolation: "isolate", position: "relative", zIndex: 0 }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[9px]">
        <p className="text-muted">
          Click the map or drag the pin to place the incident.
        </p>
        {value && (
          <p className="text-cyan">
            Lat {value.lat.toFixed(5)} · Lng {value.lng.toFixed(5)}
          </p>
        )}
      </div>
    </div>
  );
}