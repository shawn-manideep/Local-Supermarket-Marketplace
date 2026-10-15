import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

export const MAP_PROVIDER = {
  tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  search: "https://photon.komoot.io/api/",
  reverse: "https://photon.komoot.io/reverse",
  timeoutMs: 10_000,
} as const;

export type Coordinates = { latitude: number; longitude: number };
export function validCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): latitude is number {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}
function coordinatesFrom(latitude: number | null | undefined, longitude: number | null | undefined): Coordinates | null {
  if (typeof latitude !== "number" || typeof longitude !== "number" || !validCoordinates(latitude, longitude)) return null;
  return { latitude, longitude };
}
export function coordinatesForForm(value: Coordinates | null) {
  return { latitude: value?.latitude ?? "", longitude: value?.longitude ?? "" };
}

type PhotonFeature = { geometry?: { coordinates?: [number, number] }; properties?: { name?: string; street?: string; housenumber?: string; city?: string; district?: string; state?: string; country?: string; postcode?: string } };
type SearchResult = { coordinates: Coordinates; label: string };
function placeLabel(properties: PhotonFeature["properties"] = {}) {
  return [properties?.name, properties?.street && properties.housenumber ? `${properties.housenumber} ${properties.street}` : properties?.street, properties?.district, properties?.city, properties?.state, properties?.postcode, properties?.country]
    .filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index).join(", ");
}

async function photon(url: URL, signal: AbortSignal): Promise<PhotonFeature[]> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Location service returned ${response.status}.`);
  const result = await response.json() as { features?: PhotonFeature[] };
  return result.features ?? [];
}

export function StoreLocationMap({ latitude, longitude, editable }: { latitude?: number | null; longitude?: number | null; editable: boolean }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [point, setPoint] = useState<Coordinates | null>(() => coordinatesFrom(latitude, longitude));
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [mapError, setMapError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const reverseController = useRef<AbortController | null>(null);
  const stableInitial = useRef(`${latitude ?? ""}:${longitude ?? ""}`);
  useEffect(() => {
    const nextKey = `${latitude ?? ""}:${longitude ?? ""}`;
    if (stableInitial.current === nextKey) return;
    stableInitial.current = nextKey;
    setPoint(coordinatesFrom(latitude, longitude));
  }, [latitude, longitude]);

  useEffect(() => {
    let active = true;
    let map: LeafletMap | null = null;
    let marker: Marker | null = null;
    let tileTimer: number | undefined;
    let tileLoaded = false;
    const init = async () => {
      try {
        const leaflet = await import("leaflet");
        if (!active || !mapElement.current) return;
        const initial = validCoordinates(latitude, longitude) ? [latitude, longitude] as [number, number] : [20.5937, 78.9629] as [number, number];
        map = leaflet.map(mapElement.current, { scrollWheelZoom: false, zoomControl: true })
          .setView(initial, validCoordinates(latitude, longitude) ? 16 : 5);
        const tiles = leaflet.tileLayer(MAP_PROVIDER.tiles, {
          attribution: MAP_PROVIDER.attribution,
          maxZoom: 19,
          // Keep the browser's ordinary cache and referrer behavior for OSM tiles.
        }).addTo(map);
        tileTimer = window.setTimeout(() => {
          if (active && !tileLoaded) setMapError("Map tiles are taking too long to load. Retry the map; your saved pin remains unchanged.");
        }, MAP_PROVIDER.timeoutMs);
        tiles.on("tileload", () => {
          tileLoaded = true;
          if (tileTimer) window.clearTimeout(tileTimer);
          if (active) { setMapReady(true); setMapError(""); }
        });
        tiles.on("tileerror", () => {
          if (active) setMapError("Map tiles are temporarily unavailable. Retry the map; your saved pin remains unchanged.");
        });
        if (validCoordinates(latitude, longitude)) {
          marker = leaflet.marker(initial, {
            draggable: editable,
            icon: leaflet.divIcon({ className: "lb-map-pin-shell", html: '<span class="lb-map-pin" aria-hidden="true"></span>', iconSize: [28, 38], iconAnchor: [14, 36] }),
            title: "Store location",
          }).addTo(map);
          marker.on("dragend", () => {
            const position = marker?.getLatLng();
            if (position) setPoint({ latitude: position.lat, longitude: position.lng });
          });
        }
        if (editable) map.on("click", (event) => {
          const next = { latitude: event.latlng.lat, longitude: event.latlng.lng };
          if (!marker) {
            marker = leaflet.marker([next.latitude, next.longitude], {
              draggable: true,
              icon: leaflet.divIcon({ className: "lb-map-pin-shell", html: '<span class="lb-map-pin" aria-hidden="true"></span>', iconSize: [28, 38], iconAnchor: [14, 36] }),
              title: "Store location",
            }).addTo(map!);
            marker.on("dragend", () => {
              const position = marker?.getLatLng();
              if (position) setPoint({ latitude: position.lat, longitude: position.lng });
            });
            markerRef.current = marker;
          } else marker.setLatLng([next.latitude, next.longitude]);
          setPoint(next);
          setLabel("");
        });
        mapRef.current = map;
        markerRef.current = marker;
        window.setTimeout(() => map?.invalidateSize(), 50);
      } catch {
        if (active) setMapError("The interactive map could not be loaded. Check your connection and retry; saved coordinates remain unchanged.");
      }
    };
    void init();
    return () => {
      active = false;
      if (tileTimer) window.clearTimeout(tileTimer);
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [attempt, editable]);

  useEffect(() => {
    if (!point || !mapRef.current) return;
    let active = true;
    void import("leaflet").then((leaflet) => {
      if (!active || !mapRef.current) return;
      if (!markerRef.current) {
        markerRef.current = leaflet.marker([point.latitude, point.longitude], {
          draggable: editable,
          icon: leaflet.divIcon({ className: "lb-map-pin-shell", html: '<span class="lb-map-pin" aria-hidden="true"></span>', iconSize: [28, 38], iconAnchor: [14, 36] }),
          title: "Store location",
        }).addTo(mapRef.current);
        markerRef.current.on("dragend", () => {
          const position = markerRef.current?.getLatLng();
          if (position) setPoint({ latitude: position.lat, longitude: position.lng });
        });
      } else {
        const current = markerRef.current.getLatLng();
        if (Math.abs(current.lat - point.latitude) > 0.0000001 || Math.abs(current.lng - point.longitude) > 0.0000001)
          markerRef.current.setLatLng([point.latitude, point.longitude]);
      }
    }).catch(() => setMapError("The map pin could not be updated. Retry the map before saving."));
    return () => { active = false; };
  }, [point]);

  const locateLabel = async (coords: Coordinates, signal: AbortSignal) => {
    const controller = new AbortController();
    const abortLookup = () => controller.abort();
    signal.addEventListener("abort", abortLookup, { once: true });
    const timeout = window.setTimeout(abortLookup, MAP_PROVIDER.timeoutMs);
    try {
      const url = new URL(MAP_PROVIDER.reverse);
      url.searchParams.set("lat", String(coords.latitude));
      url.searchParams.set("lon", String(coords.longitude));
      const features = await photon(url, controller.signal);
      if (!signal.aborted && features[0]) setLabel(placeLabel(features[0].properties) || "Pinned location");
    } catch {
      if (!signal.aborted) setLabel("Pinned coordinates");
    } finally {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abortLookup);
    }
  };
  useEffect(() => {
    reverseController.current?.abort();
    if (!point) { setLabel(""); return; }
    const controller = new AbortController();
    reverseController.current = controller;
    void locateLabel(point, controller.signal);
    return () => controller.abort();
  }, [point?.latitude, point?.longitude]);

  const search = async () => {
    if (!query.trim() || busy) return;
    setBusy(true); setSearchError(""); setResults([]);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), MAP_PROVIDER.timeoutMs);
    try {
      const url = new URL(MAP_PROVIDER.search);
      url.searchParams.set("q", query.trim());
      url.searchParams.set("limit", "5");
      const features = await photon(url, controller.signal);
      const found = features.flatMap((feature) => {
        const coordinates = feature.geometry?.coordinates;
        if (!coordinates || !validCoordinates(coordinates[1], coordinates[0])) return [];
        return [{ coordinates: { longitude: coordinates[0], latitude: coordinates[1] }, label: placeLabel(feature.properties) || "Search result" }];
      });
      setResults(found);
      if (!found.length) setSearchError("No matching places found. You can still select the exact spot directly on the map.");
    } catch (error) {
      setSearchError(error instanceof Error && error.name === "AbortError" ? "Location search timed out. Retry or pin the location on the map." : "Location search is temporarily unavailable. Retry or pin the location on the map.");
    } finally { window.clearTimeout(timeout); setBusy(false); }
  };
  const chooseResult = (result: SearchResult) => {
    setPoint(result.coordinates); setLabel(result.label); setResults([]);
    mapRef.current?.setView([result.coordinates.latitude, result.coordinates.longitude], 17);
    if (markerRef.current) markerRef.current.setLatLng([result.coordinates.latitude, result.coordinates.longitude]);
  };

  const hidden = coordinatesForForm(point);
  return <div className="lb-store-location">
    {editable && <>
      <p className="lb-store-location-copy">Search for an address, then pin the precise storefront entrance. Tap or click to place the pin; drag it to refine.</p>
      <div className="lb-location-search" role="search">
        <label className="lb-sr-only" htmlFor="store-location-search">Search location</label>
        <input id="store-location-search" aria-label="Search location" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Search street, area, or landmark" />
        <button type="button" disabled={busy || !query.trim()} onClick={() => void search()}>{busy ? "Searching…" : "Search"}</button>
      </div>
      {searchError && <p className="lb-location-error" role="status">{searchError}</p>}
      {results.length > 0 && <ul className="lb-location-results">{results.map((result, index) => <li key={`${result.coordinates.latitude}:${result.coordinates.longitude}`}><button type="button" onClick={() => chooseResult(result)}>{result.label || `Result ${index + 1}`}</button></li>)}</ul>}
    </>}
    {!mapReady && !mapError && <p className="lb-location-map-loading" role="status">Loading OpenStreetMap tiles…</p>}
    <div className="lb-location-map" ref={mapElement} role="application" aria-label={editable ? "Map to pin store location" : "Map showing saved store location"} />
    {mapError && <div className="lb-location-error" role="alert">{mapError}<button type="button" onClick={() => { setMapReady(false); setMapError(""); setAttempt((value) => value + 1); }}>Retry map</button></div>}
    <div className="lb-location-summary">
      <span>{point ? label || "Pinned location" : "No exact location saved"}</span>
      {point && <code>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</code>}
    </div>
    <p className="lb-location-disclosure">Location searches and reverse lookups are sent to Photon (Komoot); map tiles are provided by OpenStreetMap. Do not enter private information in search.</p>
    <input type="hidden" name="latitude" value={hidden.latitude} readOnly />
    <input type="hidden" name="longitude" value={hidden.longitude} readOnly />
  </div>;
}
