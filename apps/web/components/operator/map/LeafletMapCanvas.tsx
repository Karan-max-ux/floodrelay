'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Popup, useMap } from 'react-leaflet';
import type {
  RescueRequest,
  BlockedZone,
  FloodForecastContext,
  ResourceType,
} from '@floodrelay/shared';
import type { AssignmentRecord } from '@/lib/api/types';
import {
  TACTICAL_MAP_DEFAULT_CENTRE,
  TACTICAL_MAP_DEFAULT_ZOOM,
} from '@/lib/fixtures/mapReferenceData';
import { getTileConfig } from './tileConfig';
import {
  extractRepairStops,
  formatDistanceKm,
  formatDurationMinutes,
  getRepairRouteStyle,
  getRouteDisplayMetrics,
  getRouteSegmentsForRendering,
  isNonRoadResource,
  isValidLatLngTuple,
  type RouteMode,
} from './routeDisplay';

export interface StagedAsset {
  id: string;
  name: string;
  type: ResourceType;
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
  selectedRepairAssignment?: AssignmentRecord | null;
  activeRepairRouteIndex?: number;
  onSelectRepairRoute?: (routeIndex: number) => void;
  blockedZones?: BlockedZone[];
  repairRoutePolylines?: Array<{ resourceId: string; latlngs: [number, number][] }>;
  forecastContext?: FloodForecastContext | null;
  layers: MapLayers;
  urgencyFilter: string;
  selectedEntity: SelectedMapEntity;
  onSelectEntity: (entity: SelectedMapEntity) => void;
  tileTheme: 'dark' | 'standard';
  actionTrigger?: { type: 'fit' | 'center-critical' | 'zoom-in' | 'zoom-out'; id: number } | null;
  routeMode?: RouteMode;
  onSwitchRouteMode?: (mode: RouteMode) => void;
  resourceTypeMap?: Map<string, string>;
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

function getCraftIcon(name: string, isSelected: boolean, type?: string): L.DivIcon {
  const selectedRing = isSelected
    ? 'ring-4 ring-teal-400 ring-offset-2 ring-offset-slate-900 scale-110'
    : '';
  const isVehicle = type === 'HIGH_WATER_VEHICLE' || type === 'TRUCK';
  const isHeli = type === 'HELICOPTER';
  const icon = isVehicle ? 'local_shipping' : isHeli ? 'flight' : 'directions_boat';
  const html = `
    <div class="flex flex-col items-center cursor-pointer transition-transform duration-150">
      <div class="flex items-center justify-center w-7 h-7 rounded-lg bg-teal-700 border-2 border-teal-300 text-white shadow-xl ${selectedRing}">
        <span class="material-symbols-outlined text-[16px]">${icon}</span>
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

// Google Maps-style Repair Route Stop Marker Generators
function getRepairStartIcon(title = 'START'): L.DivIcon {
  const html = `
    <div class="relative flex flex-col items-center justify-center cursor-pointer -translate-x-1/2 -translate-y-1/2" data-testid="repair-start-marker">
      <div class="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white font-mono font-bold text-xs shadow-xl border-2 border-white ring-2 ring-emerald-500/70">
        <span class="material-symbols-outlined text-[15px]">home_repair_service</span>
      </div>
      <span class="mt-0.5 text-[8.5px] font-bold font-mono uppercase tracking-wider bg-slate-900/95 text-emerald-300 px-1 py-0.2 rounded shadow whitespace-nowrap border border-emerald-500/40">
        ${title}
      </span>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-repair-start-marker',
    iconSize: [28, 42],
    iconAnchor: [14, 21],
    popupAnchor: [0, -21],
  });
}

function getRepairDestinationIcon(title = 'DEST'): L.DivIcon {
  const html = `
    <div class="relative flex flex-col items-center justify-center cursor-pointer -translate-x-1/2 -translate-y-1/2" data-testid="repair-dest-marker">
      <div class="flex items-center justify-center w-7 h-7 rounded-full bg-rose-600 text-white font-mono font-bold text-xs shadow-xl border-2 border-white ring-2 ring-rose-500/70">
        <span class="material-symbols-outlined text-[15px]">flag</span>
      </div>
      <span class="mt-0.5 text-[8.5px] font-bold font-mono uppercase tracking-wider bg-slate-900/95 text-rose-300 px-1 py-0.2 rounded shadow whitespace-nowrap border border-rose-500/40">
        ${title}
      </span>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-repair-dest-marker',
    iconSize: [28, 42],
    iconAnchor: [14, 21],
    popupAnchor: [0, -21],
  });
}

function getRepairIntermediateIcon(stopNumber: number): L.DivIcon {
  const html = `
    <div class="relative flex items-center justify-center cursor-pointer -translate-x-1/2 -translate-y-1/2" data-testid="repair-stop-marker">
      <div class="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white font-mono font-bold text-[11px] shadow-lg border-2 border-white ring-2 ring-blue-400/60">
        ${stopNumber}
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-repair-stop-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

// Controller component for programmatic map viewport movements
function MapMovementController({
  allCoordinates,
  operationalCoordinates,
  activeRouteCoordinates,
  selectedEntity,
  actionTrigger,
}: {
  allCoordinates: [number, number][];
  operationalCoordinates: [number, number][];
  activeRouteCoordinates?: [number, number][];
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
    if (activeRouteCoordinates && activeRouteCoordinates.length > 1) {
      const bounds = L.latLngBounds(activeRouteCoordinates.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [56, 56], maxZoom: 14, animate: true });
    } else if (selectedEntity) {
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
  }, [selectedEntity, activeRouteCoordinates, map]);

  return null;
}

export default function LeafletMapCanvas({
  requests,
  stagedFleet,
  stagedShelters,
  selectedAssignment,
  selectedRepairAssignment,
  activeRepairRouteIndex = 0,
  onSelectRepairRoute,
  blockedZones = [],
  repairRoutePolylines = [],
  forecastContext,
  layers,
  urgencyFilter,
  selectedEntity,
  onSelectEntity,
  tileTheme,
  actionTrigger,
  routeMode = 'ROAD',
  resourceTypeMap,
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

  // Build lookup of resource types from staged fleet or props
  const effectiveResourceTypeMap = useMemo(() => {
    const map = new Map<string, string>(resourceTypeMap ?? []);
    stagedFleet.forEach((f) => map.set(f.id, f.type));
    return map;
  }, [resourceTypeMap, stagedFleet]);

  // Track currently selected incident ID to highlight its route
  const selectedIncidentId = selectedEntity?.type === 'incident' ? selectedEntity.item.id : null;

  // Assignment polyline vectors (road-following OSRM segments when available, straight-line fallback/policy)
  const renderedRoutes = useMemo(() => {
    if (!layers.routes || !selectedAssignment?.routes) return [];

    return selectedAssignment.routes.map((route) => {
      const servesSelectedIncident = selectedIncidentId
        ? (route.servedRequestIds && route.servedRequestIds.includes(selectedIncidentId)) ||
          (route.stops && route.stops.some((s) => s.targetId === selectedIncidentId))
        : false;

      const originStop =
        route.stops?.find((s) => s.type === 'DEPOT' || s.stopNumber === 0) || route.stops?.[0];
      const originCoord: [number, number] | null =
        originStop && typeof originStop.lat === 'number' && typeof originStop.lng === 'number'
          ? [originStop.lat, originStop.lng]
          : route.geometry?.coordinates &&
              route.geometry.coordinates.length > 0 &&
              isValidLatLngTuple(route.geometry.coordinates[0])
            ? [route.geometry.coordinates[0][0], route.geometry.coordinates[0][1]]
            : null;

      const matchedCraft = stagedFleet.find((f) => f.id === route.resourceId);
      const resourceName =
        matchedCraft?.name ||
        (route.resourceId === 'res_truck_ncr_1' ? 'Delhi Rescue Truck 1' : route.resourceId);
      const isNonRoad = isNonRoadResource(
        route.resourceId,
        matchedCraft?.type,
        effectiveResourceTypeMap,
      );

      return {
        resourceId: route.resourceId,
        resourceName,
        originCoord,
        isNonRoad,
        servesSelectedIncident,
        metrics: getRouteDisplayMetrics(route, routeMode, undefined, effectiveResourceTypeMap),
        segments: getRouteSegmentsForRendering(
          route,
          tileTheme,
          routeMode,
          undefined,
          effectiveResourceTypeMap,
        ),
      };
    });
  }, [
    layers.routes,
    selectedAssignment,
    tileTheme,
    routeMode,
    effectiveResourceTypeMap,
    stagedFleet,
    selectedIncidentId,
  ]);

  const activeRouteCoordinates: [number, number][] = useMemo(() => {
    if (!selectedIncidentId) return [];
    const activeRoute = renderedRoutes.find((r) => r.servesSelectedIncident);
    if (!activeRoute) return [];
    const coords: [number, number][] = [];
    if (activeRoute.originCoord) coords.push(activeRoute.originCoord);
    activeRoute.segments.forEach((seg) => {
      seg.positions.forEach((pt) => coords.push(pt));
    });
    return coords;
  }, [selectedIncidentId, renderedRoutes]);

  // Real repair routes (hydrated from selectedRepairAssignment with OSRM road geometry or direct mode)
  const renderedRepairRoutes = useMemo(() => {
    if (!layers.repairOverlay || !selectedRepairAssignment?.routes) return [];

    return selectedRepairAssignment.routes.map((route, routeIdx) => {
      const isActiveRoute = routeIdx === activeRepairRouteIndex;
      const metrics = getRouteDisplayMetrics(route, routeMode, undefined, effectiveResourceTypeMap);
      const segments = getRouteSegmentsForRendering(
        route,
        tileTheme,
        routeMode,
        undefined,
        effectiveResourceTypeMap,
      );
      const stops = extractRepairStops(route);
      const style = getRepairRouteStyle(isActiveRoute, routeMode, tileTheme);

      return {
        route,
        routeIdx,
        resourceId: route.resourceId,
        isActiveRoute,
        metrics,
        segments,
        stops,
        style,
      };
    });
  }, [
    layers.repairOverlay,
    selectedRepairAssignment,
    activeRepairRouteIndex,
    routeMode,
    tileTheme,
    effectiveResourceTypeMap,
  ]);

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
          activeRouteCoordinates={activeRouteCoordinates}
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
                icon={getCraftIcon(craft.name, isSelected, craft.type)}
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
          renderedRoutes.map((routeItem) => {
            const hasFocusedIncident = Boolean(selectedIncidentId);
            const isHighlighted = routeItem.servesSelectedIncident;

            return routeItem.segments.map((seg) => {
              if (!seg.positions || seg.positions.length < 2) {
                return null;
              }

              const polylineOpacity = hasFocusedIncident
                ? isHighlighted
                  ? 1.0
                  : 0.35
                : seg.style.opacity;
              const polylineWeight = hasFocusedIncident
                ? isHighlighted
                  ? seg.style.weight + 2
                  : Math.max(2, seg.style.weight - 1)
                : seg.style.weight;

              return (
                <Polyline
                  key={seg.key}
                  positions={seg.positions}
                  pathOptions={{
                    color: isHighlighted
                      ? tileTheme === 'standard'
                        ? '#1d4ed8'
                        : '#60a5fa'
                      : seg.style.color,
                    weight: polylineWeight,
                    opacity: polylineOpacity,
                    lineCap: 'round',
                    lineJoin: 'round',
                    ...(seg.style.dashArray ? { dashArray: seg.style.dashArray } : {}),
                  }}
                >
                  <Popup>
                    <div className="text-xs p-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          Unit: {routeItem.resourceId}
                        </span>
                        {routeItem.servesSelectedIncident && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                            Serves Selected Request
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                        {seg.isNonRoadResource
                          ? 'Watercraft / Air Transit Vector'
                          : routeMode === 'DIRECT'
                            ? 'Direct / Air Straight-Line'
                            : 'OSRM Road Route'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                        {formatDistanceKm(routeItem.metrics.distanceKm)} •{' '}
                        {formatDurationMinutes(routeItem.metrics.durationMinutes)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {routeItem.metrics.pickupsCount} Pickup(s) •{' '}
                        {routeItem.metrics.dropoffsCount} Drop-off(s) • {seg.positions.length}{' '}
                        vertices
                      </div>
                    </div>
                  </Popup>
                </Polyline>
              );
            });
          })}

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

        {/* 6. GOOGLE MAPS-STYLE REPAIR ROUTE OVERLAY */}
        {layers.repairOverlay && (
          <>
            {/* Real Repair Routes from selectedRepairAssignment */}
            {renderedRepairRoutes.map((repairRoute) =>
              repairRoute.segments.map((seg) => {
                if (!seg.positions || seg.positions.length < 2) return null;

                return (
                  <React.Fragment key={`repair-segment-${repairRoute.routeIdx}-${seg.key}`}>
                    {/* Casing (underneath) */}
                    <Polyline
                      positions={seg.positions}
                      pathOptions={{
                        color: repairRoute.style.casing.color,
                        weight: repairRoute.style.casing.weight,
                        opacity: repairRoute.style.casing.opacity,
                        lineCap: repairRoute.style.casing.lineCap,
                        lineJoin: repairRoute.style.casing.lineJoin,
                        interactive: false,
                        ...(repairRoute.style.casing.dashArray
                          ? { dashArray: repairRoute.style.casing.dashArray }
                          : {}),
                      }}
                    />
                    {/* Main Line (on top) */}
                    <Polyline
                      positions={seg.positions}
                      pathOptions={{
                        color: repairRoute.style.main.color,
                        weight: repairRoute.style.main.weight,
                        opacity: repairRoute.style.main.opacity,
                        lineCap: repairRoute.style.main.lineCap,
                        lineJoin: repairRoute.style.main.lineJoin,
                        ...(repairRoute.style.main.dashArray
                          ? { dashArray: repairRoute.style.main.dashArray }
                          : {}),
                      }}
                      eventHandlers={{
                        click: () => onSelectRepairRoute?.(repairRoute.routeIdx),
                      }}
                    >
                      <Popup className="custom-leaflet-popup">
                        <div className="text-xs p-1.5 space-y-1.5 max-w-xs">
                          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/80 pb-1">
                            <span className="font-mono font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">build</span>
                              Unit: {repairRoute.resourceId}
                            </span>
                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                                repairRoute.isActiveRoute
                                  ? 'bg-blue-100 text-blue-800 border-blue-400 dark:bg-blue-900/60 dark:text-blue-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {repairRoute.isActiveRoute ? 'Active Repair Route' : 'Repair Route'}
                            </span>
                          </div>
                          <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                            {routeMode === 'DIRECT'
                              ? 'Direct / Air Straight-Line Vector'
                              : 'Google Maps-Style Road Route (OSRM)'}
                          </div>
                          <div className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                            {formatDistanceKm(repairRoute.metrics.distanceKm)} •{' '}
                            {formatDurationMinutes(repairRoute.metrics.durationMinutes)}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {repairRoute.stops.length} Stops • {seg.positions.length} road vertices
                          </div>
                        </div>
                      </Popup>
                    </Polyline>
                  </React.Fragment>
                );
              }),
            )}

            {/* Repair Route Stop Markers (Start, Intermediate, Destination) */}
            {renderedRepairRoutes.map((repairRoute) => {
              if (!repairRoute.isActiveRoute && renderedRepairRoutes.length > 1) return null;

              return repairRoute.stops.map((stop) => {
                const icon = stop.isStart
                  ? getRepairStartIcon('START')
                  : stop.isEnd
                    ? getRepairDestinationIcon('DEST')
                    : getRepairIntermediateIcon(stop.stopNumber);

                return (
                  <Marker
                    key={`repair-stop-${repairRoute.routeIdx}-${stop.stopNumber}-${stop.targetId}`}
                    position={[stop.lat, stop.lng]}
                    icon={icon}
                  >
                    <Popup className="custom-leaflet-popup">
                      <div className="text-xs p-1 space-y-1">
                        <div className="font-bold text-blue-700 dark:text-blue-400 font-mono">
                          {stop.label}
                        </div>
                        <div className="text-[11px] text-slate-700 dark:text-slate-300">
                          Target: <span className="font-mono font-bold">{stop.targetId}</span>
                        </div>
                        {stop.estimatedArrivalMinutes !== undefined && (
                          <div className="text-[10px] text-slate-500 font-mono">
                            Est. Arrival: ~{Math.round(stop.estimatedArrivalMinutes)} min
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400 font-mono">
                          {stop.lat.toFixed(5)}°N, {stop.lng.toFixed(5)}°E
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              });
            })}

            {/* Legacy repairRoutePolylines fallback: rendered with Google Maps Blue and casing */}
            {renderedRepairRoutes.length === 0 &&
              repairRoutePolylines.map((route, idx) => (
                <React.Fragment key={`legacy-repair-${route.resourceId}-${idx}`}>
                  <Polyline
                    positions={route.latlngs}
                    pathOptions={{
                      color: tileTheme === 'standard' ? '#ffffff' : '#0f172a',
                      weight: 8,
                      opacity: 0.85,
                      lineCap: 'round',
                      lineJoin: 'round',
                      interactive: false,
                    }}
                  />
                  <Polyline
                    positions={route.latlngs}
                    pathOptions={{
                      color: '#4285F4',
                      weight: 5,
                      opacity: 1.0,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                </React.Fragment>
              ))}
          </>
        )}

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
