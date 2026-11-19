'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Popup, useMap } from 'react-leaflet';
import type { RescueRequest, BlockedZone, FloodForecastContext } from '@floodrelay/shared';
import type { AssignmentRecord } from '@/lib/api/types';
import {
  TACTICAL_MAP_DEFAULT_CENTRE,
  TACTICAL_MAP_DEFAULT_ZOOM,
} from '@/lib/fixtures/mapReferenceData';
import { getTileConfig } from './tileConfig';
import {
  formatDistanceKm,
  formatDurationMinutes,
  getRouteDisplayMetrics,
  getRouteSegmentsForRendering,
  getRouteSourceLabel,
} from './routeDisplay';

export interface StagedAsset {
  id: string;
  name: string;
  type: 'BOAT' | 'HIGH_WATER_VEHICLE' | 'HELICOPTER';
  capacity: number;
  speedKmH: number;
  lat: number;
  lng: number;
  status: 'AVAILABLE' | 'ASSIGNED' | 'STANDBY';
  depotName: string;
  source?: string;
}

export interface StagedShelter {
  id: string;
  name: string;
  lat: number;
  lng: number;
  capacity: number;
  availableBeds: number;
  status: string;
  source?: string;
}

export type SelectedMapEntity =
  | { type: 'incident'; item: RescueRequest }
  | { type: 'craft'; item: StagedAsset }
  | { type: 'shelter'; item: StagedShelter }
  | null;

export interface MapLayers {
  incidents: boolean;
  craft: boolean;
  shelters: boolean;
  routes: boolean;
  blockages: boolean;
  repairOverlay: boolean;
  floodForecast: boolean;
}

interface LeafletMapCanvasProps {
  requests: RescueRequest[];
  stagedFleet: StagedAsset[];
  stagedShelters: StagedShelter[];
  selectedAssignment: AssignmentRecord | null;
  blockedZones?: BlockedZone[];
  repairRoutePolylines?: Array<{ resourceId: string; latlngs: [number, number][] }>;
  forecastContext?: FloodForecastContext | null;
  layers: MapLayers;
  urgencyFilter: string;
  selectedEntity: SelectedMapEntity;
  onSelectEntity: (entity: SelectedMapEntity) => void;
  tileTheme: 'dark' | 'standard';
  actionTrigger?: { type: 'fit' | 'center-critical' | 'zoom-in' | 'zoom-out'; id: number } | null;
}

// Marker icon generators
function getIncidentIcon(urgency: string, peopleCount: number, isSelected: boolean): L.DivIcon {
  const isCritical = urgency === 'CRITICAL';
  const isHigh = urgency === 'HIGH';
  const isMedium = urgency === 'MEDIUM';

  const colorClass = isCritical
    ? 'bg-red-600 border-red-300 text-white'
    : isHigh
      ? 'bg-amber-600 border-amber-300 text-white'
      : isMedium
        ? 'bg-yellow-500 border-yellow-200 text-slate-950 font-black'
        : 'bg-sky-600 border-sky-300 text-white';

  const pulseRing = isCritical
    ? '<span class="absolute -inset-1 rounded-full bg-red-500 animate-ping opacity-60"></span>'
    : '';
  const selectedRing = isSelected
    ? 'ring-4 ring-teal-400 ring-offset-2 ring-offset-slate-900 scale-125 z-50'
    : '';

  const html = `
    <div class="relative flex items-center justify-center cursor-pointer transition-transform duration-150">
      ${pulseRing}
      <div class="relative flex items-center justify-center w-7 h-7 rounded-full border-2 font-mono font-bold text-xs shadow-xl ${colorClass} ${selectedRing}">
        ${peopleCount}
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-incident-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function getCraftIcon(name: string, isSelected: boolean): L.DivIcon {
  const selectedRing = isSelected
    ? 'ring-4 ring-teal-400 ring-offset-2 ring-offset-slate-900 scale-110'
    : '';
  const html = `
    <div class="flex flex-col items-center cursor-pointer transition-transform duration-150">
      <div class="flex items-center justify-center w-7 h-7 rounded-lg bg-teal-700 border-2 border-teal-300 text-white shadow-xl ${selectedRing}">
        <span class="material-symbols-outlined text-[16px]">directions_boat</span>
      </div>
      <div class="px-1.5 py-0.2 rounded bg-slate-950/95 border border-teal-500/60 text-[10px] text-teal-300 font-mono font-bold whitespace-nowrap mt-0.5 shadow-md">
        ${name}
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-craft-marker',
    iconSize: [48, 44],
    iconAnchor: [24, 14],
    popupAnchor: [0, -14],
  });
}

function getShelterIcon(name: string, isSelected: boolean): L.DivIcon {
  const selectedRing = isSelected
    ? 'ring-4 ring-emerald-400 ring-offset-2 ring-offset-slate-900 scale-110'
    : '';
  const html = `
    <div class="flex flex-col items-center cursor-pointer transition-transform duration-150">
      <div class="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-800 border-2 border-emerald-300 text-white shadow-xl ${selectedRing}">
        <span class="material-symbols-outlined text-[16px]">night_shelter</span>
      </div>
      <div class="px-1.5 py-0.2 rounded bg-slate-950/95 border border-emerald-500/60 text-[10px] text-emerald-300 font-mono font-bold whitespace-nowrap mt-0.5 shadow-md">
        ${name}
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-shelter-marker',
    iconSize: [48, 44],
    iconAnchor: [24, 14],
    popupAnchor: [0, -14],
  });
}

function getRiverStationIcon(risk: string): L.DivIcon {
  const isExtreme = risk === 'EXTREME';
  const isHigh = risk === 'HIGH';
  const isElevated = risk === 'ELEVATED';
  const isUnavailable = risk === 'UNAVAILABLE' || risk === 'UNKNOWN';

  const badgeColor = isExtreme
    ? 'bg-purple-600 border-purple-300 text-white'
    : isHigh
      ? 'bg-rose-600 border-rose-300 text-white'
      : isElevated
        ? 'bg-amber-600 border-amber-300 text-white'
        : isUnavailable
          ? 'bg-slate-700 border-slate-500 text-slate-300'
          : 'bg-cyan-600 border-cyan-300 text-white';

  const pingHtml = isUnavailable
    ? ''
    : `<span class="absolute -inset-1 rounded-full bg-cyan-400 animate-ping opacity-40"></span>`;

  const html = `
    <div class="relative flex items-center justify-center cursor-pointer" data-testid="forecast-marker">
      ${pingHtml}
      <div class="relative flex items-center justify-center w-8 h-8 rounded-full border-2 font-mono font-bold text-xs shadow-2xl ${badgeColor}">
        <span class="material-symbols-outlined text-[16px]">waves</span>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-forecast-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
}

// Controller component for programmatic map viewport movements
function MapMovementController({
  allCoordinates,
  operationalCoordinates,
  selectedEntity,
  actionTrigger,
}: {
  allCoordinates: [number, number][];
  operationalCoordinates: [number, number][];
  selectedEntity: SelectedMapEntity;
  actionTrigger?: { type: 'fit' | 'center-critical' | 'zoom-in' | 'zoom-out'; id: number } | null;
}) {
  const map = useMap();
  const userHasInteractedRef = useRef(false);
  const hasAutoFittedRef = useRef(false);

  // Track explicit user pan/zoom so we never override operator viewport control
  useEffect(() => {
    const markUserInteraction = () => {
      userHasInteractedRef.current = true;
    };
    map.on('dragstart', markUserInteraction);
    map.on('zoomstart', markUserInteraction);
    return () => {
      map.off('dragstart', markUserInteraction);
      map.off('zoomstart', markUserInteraction);
    };
  }, [map]);

  // Fit once to actual database coordinates (incidents/routes) if present and user has not panned/zoomed
  useEffect(() => {
    if (hasAutoFittedRef.current || userHasInteractedRef.current) return;
    if (operationalCoordinates.length === 0) return;

    hasAutoFittedRef.current = true;
    if (operationalCoordinates.length === 1) {
      map.setView(operationalCoordinates[0]!, Math.max(map.getZoom(), 13), { animate: false });
    } else {
      const bounds = L.latLngBounds(operationalCoordinates.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: false });
    }
  }, [operationalCoordinates, map]);

  useEffect(() => {
    if (!actionTrigger) return;

    if (actionTrigger.type === 'fit' && allCoordinates.length > 0) {
      const bounds = L.latLngBounds(allCoordinates.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } else if (actionTrigger.type === 'center-critical') {
      const criticalCoords = allCoordinates[0];
      if (criticalCoords) {
        map.setView(criticalCoords, 14, { animate: true });
      }
    } else if (actionTrigger.type === 'zoom-in') {
      map.zoomIn();
    } else if (actionTrigger.type === 'zoom-out') {
      map.zoomOut();
    }
  }, [actionTrigger, allCoordinates, map]);

  useEffect(() => {
    if (selectedEntity) {
      const target = selectedEntity.item;
      if (
        'lat' in target &&
        'lng' in target &&
        typeof target.lat === 'number' &&
        typeof target.lng === 'number'
      ) {
        map.panTo([target.lat, target.lng], { animate: true });
      }
    }
  }, [selectedEntity, map]);

  return null;
}

export default function LeafletMapCanvas({
  requests,
  stagedFleet,
  stagedShelters,
  selectedAssignment,
  blockedZones = [],
  repairRoutePolylines = [],
  forecastContext,
  layers,
  urgencyFilter,
  selectedEntity,
  onSelectEntity,
  tileTheme,
  actionTrigger,
}: LeafletMapCanvasProps) {
  // Validate and filter incident requests by urgency
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number' || isNaN(r.lat) || isNaN(r.lng)) {
        return false;
      }
      if (r.lat < -90 || r.lat > 90 || r.lng < -180 || r.lng > 180) {
        return false;
      }
      if (urgencyFilter !== 'ALL' && r.urgency !== urgencyFilter) {
        return false;
      }
      return true;
    });
  }, [requests, urgencyFilter]);

  // Aggregate all visible coordinates for bounds fitting
  const allCoordinates: [number, number][] = useMemo(() => {
    const coords: [number, number][] = [];
    if (layers.incidents) {
      filteredRequests.forEach((r) => coords.push([r.lat, r.lng]));
    }
    if (layers.craft) {
      stagedFleet.forEach((f) => coords.push([f.lat, f.lng]));
    }
    if (layers.shelters) {
      stagedShelters.forEach((s) => coords.push([s.lat, s.lng]));
    }
    return coords;
  }, [filteredRequests, stagedFleet, stagedShelters, layers]);

  // Centralised Delhi–Yamuna tactical map default centre (does not constrain database coordinates)
  const defaultCenter: [number, number] = TACTICAL_MAP_DEFAULT_CENTRE;

  // Tile layer configuration
  const tileConfig = getTileConfig(tileTheme);

  // Assignment polyline vectors (road-following OSRM segments when available, straight-line fallback/policy)
  const renderedRoutes = useMemo(() => {
    if (!layers.routes || !selectedAssignment?.routes) return [];

    return selectedAssignment.routes.map((route) => ({
      resourceId: route.resourceId,
      metrics: getRouteDisplayMetrics(route),
      segments: getRouteSegmentsForRendering(route, tileTheme),
    }));
  }, [layers.routes, selectedAssignment, tileTheme]);

  // Operational coordinates (database incidents + selected assignment route vertices) for initial auto-fit
  const operationalCoordinates: [number, number][] = useMemo(() => {
    const coords: [number, number][] = [];
    if (layers.incidents) {
      filteredRequests.forEach((r) => coords.push([r.lat, r.lng]));
    }
    if (layers.routes) {
      renderedRoutes.forEach((routeItem) => {
        routeItem.segments.forEach((seg) => {
          seg.positions.forEach((pt) => coords.push(pt));
        });
      });
    }
    return coords;
  }, [filteredRequests, renderedRoutes, layers.incidents, layers.routes]);

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer
        center={defaultCenter}
        zoom={TACTICAL_MAP_DEFAULT_ZOOM}
        scrollWheelZoom={true}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: tileTheme === 'dark' ? '#0b1320' : '#e8eef5',
        }}
        zoomControl={false}
      >
        <TileLayer
          attribution={tileConfig.attribution}
          url={tileConfig.url}
          className={tileConfig.className}
          maxZoom={tileConfig.maxZoom}
        />

        <MapMovementController
          allCoordinates={allCoordinates}
          operationalCoordinates={operationalCoordinates}
          selectedEntity={selectedEntity}
          actionTrigger={actionTrigger}
        />

        {/* 1. INCIDENT MARKERS */}
        {layers.incidents &&
          filteredRequests.map((req) => {
            const isSelected =
              selectedEntity?.type === 'incident' && selectedEntity.item.id === req.id;
            return (
              <Marker
                key={req.id}
                position={[req.lat, req.lng]}
                icon={getIncidentIcon(req.urgency, req.peopleCount, isSelected)}
                eventHandlers={{
                  click: () => onSelectEntity({ type: 'incident', item: req }),
                }}
              >
                <Popup className="custom-leaflet-popup">
                  <div className="text-xs p-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-on-surface">{req.id}</span>
                      <span className="font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300">
                        {req.source === 'SIMULATED' ? 'SIMULATED' : 'REAL / REPORTED'}
                      </span>
                    </div>
                    <div className="text-[11px] font-semibold text-tertiary">
                      {req.urgency} Priority • {req.peopleCount} Pax
                    </div>
                    <div className="text-[10px] text-on-surface-variant line-clamp-2">
                      {req.notes || 'No caller notes'}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

        {/* 2. STAGED CRAFT MARKERS */}
        {layers.craft &&
          stagedFleet.map((craft) => {
            const isSelected =
              selectedEntity?.type === 'craft' && selectedEntity.item.id === craft.id;
            return (
              <Marker
                key={craft.id}
                position={[craft.lat, craft.lng]}
                icon={getCraftIcon(craft.name, isSelected)}
                eventHandlers={{
                  click: () => onSelectEntity({ type: 'craft', item: craft }),
                }}
              >
                <Popup>
                  <div className="text-xs p-1 space-y-1">
                    <div className="font-bold text-on-surface">{craft.name}</div>
                    <div className="text-[10px] font-mono font-bold text-amber-700 uppercase">
                      {`${craft.source || 'SIMULATED'} • Reference Fleet (Demo Only)`}
                    </div>
                    <div className="text-[10px] text-on-surface-variant">
                      Cap: {craft.capacity} pax • Depot: {craft.depotName}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

        {/* 3. SHELTER MARKERS */}
        {layers.shelters &&
          stagedShelters.map((shelter) => {
            const isSelected =
              selectedEntity?.type === 'shelter' && selectedEntity.item.id === shelter.id;
            return (
              <Marker
                key={shelter.id}
                position={[shelter.lat, shelter.lng]}
                icon={getShelterIcon(shelter.name, isSelected)}
                eventHandlers={{
                  click: () => onSelectEntity({ type: 'shelter', item: shelter }),
                }}
              >
                <Popup>
                  <div className="text-xs p-1 space-y-1">
                    <div className="font-bold text-on-surface">{shelter.name}</div>
                    <div className="text-[10px] font-mono font-bold text-amber-700 uppercase">
                      {`${shelter.source || 'SIMULATED'} • Unverified Reference`}
                    </div>
                    <div className="text-[11px] text-slate-700 font-semibold">{shelter.status}</div>
                    <div className="text-[10px] text-on-surface-variant">
                      Simulated Reference: {shelter.availableBeds} / {shelter.capacity} Beds
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

        {/* 4. ASSIGNMENT ROUTE POLYLINES */}
        {layers.routes &&
          renderedRoutes.map((routeItem) =>
            routeItem.segments.map((seg) => (
              <Polyline
                key={seg.key}
                positions={seg.positions}
                pathOptions={{
                  color: seg.style.color,
                  weight: seg.style.weight,
                  opacity: seg.style.opacity,
                  ...(seg.style.dashArray ? { dashArray: seg.style.dashArray } : {}),
                }}
              >
                <Popup>
                  <div className="text-xs p-1 space-y-1">
                    <div className="font-mono font-bold text-slate-900">
                      Unit: {routeItem.resourceId}
                    </div>
                    <div className="text-[11px] font-semibold text-blue-700">
                      {getRouteSourceLabel(routeItem.metrics.source)}
                    </div>
                    <div className="text-[11px] font-mono text-slate-700">
                      {formatDistanceKm(routeItem.metrics.distanceKm)} •{' '}
                      {formatDurationMinutes(routeItem.metrics.durationMinutes)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {routeItem.metrics.pickupsCount} Pickup(s) • {routeItem.metrics.dropoffsCount}{' '}
                      Drop-off(s) • {routeItem.metrics.vertexCount} vertices
                    </div>
                  </div>
                </Popup>
              </Polyline>
            )),
          )}

        {/* 5. ROAD HAZARDS & FLOOD SURGE ZONES */}
        {layers.blockages &&
          blockedZones.map((zone) => (
            <Polygon
              key={zone.id}
              positions={zone.polygon.map((p) => [p.lat, p.lng])}
              pathOptions={{
                color: zone.severity === 'BLOCKED' ? '#ef4444' : '#f59e0b',
                fillColor: zone.severity === 'BLOCKED' ? '#ef4444' : '#f59e0b',
                fillOpacity: 0.3,
                weight: 2,
                dashArray: '4, 4',
              }}
            >
              <Popup>
                <div className="text-xs p-1 space-y-1">
                  <div className="font-bold text-red-600 font-mono">{zone.name || zone.id}</div>
                  <div className="text-[10px] font-mono font-bold text-amber-700 uppercase">
                    SIMULATED • Synthetic Reference Hazard
                  </div>
                  <div className="text-[11px] font-semibold text-slate-700">
                    Severity: {zone.severity}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    Synthetic hazard polygon for routing evaluation; not live flood-extent
                    telemetry.
                  </div>
                </div>
              </Popup>
            </Polygon>
          ))}

        {/* 6. REPAIR ROUTE COMPARISON OVERLAY */}
        {layers.repairOverlay &&
          repairRoutePolylines.map((route, idx) => (
            <Polyline
              key={`repair-${route.resourceId}-${idx}`}
              positions={route.latlngs}
              pathOptions={{
                color: '#c084fc',
                weight: 3.5,
                dashArray: '4, 8',
                opacity: 0.95,
              }}
            />
          ))}

        {/* 7. FLOOD FORECAST RIVER REACH CONTEXT */}
        {layers.floodForecast && forecastContext && (
          <Marker
            position={[
              forecastContext.region.stationLat || 28.675,
              forecastContext.region.stationLng || 77.225,
            ]}
            icon={getRiverStationIcon(forecastContext.riskCategory)}
          >
            <Popup className="custom-leaflet-popup">
              <div className="text-xs p-1 space-y-1.5 max-w-xs select-text">
                <div className="flex items-center justify-between border-b border-slate-700/60 pb-1">
                  <span className="font-bold text-cyan-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">waves</span>
                    {forecastContext.region.name}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-900/60 text-cyan-200 border border-cyan-500/40">
                    {forecastContext.riskCategory}
                  </span>
                </div>
                <div className="text-[11px] space-y-0.5 text-slate-200">
                  <div>
                    Current Discharge:{' '}
                    <span className="font-mono font-bold text-cyan-300">
                      {forecastContext.currentDischargeM3S} {forecastContext.variable.unit}
                    </span>
                  </div>
                  <div>
                    7-Day Peak Forecast:{' '}
                    <span className="font-mono font-bold text-amber-300">
                      {forecastContext.peakForecastM3S} {forecastContext.variable.unit}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Station: {forecastContext.region.stationLat.toFixed(3)}°N,{' '}
                    {forecastContext.region.stationLng.toFixed(3)}°E
                  </div>
                </div>
                <div className="border-t border-slate-700/60 pt-1 text-[9px] text-slate-400 leading-tight">
                  <div className="font-semibold text-slate-300">{forecastContext.attribution}</div>
                  <div className="mt-1 text-slate-400 italic text-[8.5px]">
                    {forecastContext.disclaimer}
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
