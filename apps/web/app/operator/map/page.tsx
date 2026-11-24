'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { UrgencyLevel } from '@floodrelay/shared';
import { apiClient } from '@/lib/api/client';
import type { AssignmentRecord } from '@/lib/api/types';
import LeafletMapWrapper from '@/components/operator/map/LeafletMapWrapper';
import type { MapLayers, StagedAsset } from '@/components/operator/map/LeafletMapCanvas';
import {
  extractRepairStops,
  formatDistanceKm,
  formatDurationMinutes,
  getRouteDisplayMetrics,
  getRouteSourceLabel,
  isRepairAssignment,
  summarizeAssignmentRoutes,
  type RouteMode,
} from '@/components/operator/map/routeDisplay';
import { MapInspectorDrawer } from '@/components/operator/map/MapInspectorDrawer';
import { useLiveRequests } from '@/hooks/useLiveRequests';
import { useLiveAssignments } from '@/hooks/useLiveAssignments';
import { useFloodForecast } from '@/hooks/useFloodForecast';
import { useMapSelection } from '@/hooks/useMapSelection';
import { LiveStatusIndicator } from '@/components/operator/LiveStatusIndicator';
import type { LivePollingStatus } from '@/hooks/useLivePolling';
import {
  STAGED_SECTOR_FLEET,
  STAGED_SECTOR_SHELTERS,
  STAGED_SECTOR_BLOCKED_ZONES,
  MAP_SCENARIO_NAME,
  MAP_SCENARIO_COORDINATES,
} from '@/lib/fixtures/mapReferenceData';

function OperatorMapContent() {
  // Live polling for requests and assignments
  const {
    data: requests = [],
    status: requestsStatus,
    lastUpdated: requestsUpdated,
    isRefreshing: requestsRefreshing,
    refresh: refreshRequests,
  } = useLiveRequests({ intervalMs: 20000 });

  const {
    data: assignments = [],
    status: assignmentsStatus,
    lastUpdated: assignmentsUpdated,
    isRefreshing: assignmentsRefreshing,
    refresh: refreshAssignments,
  } = useLiveAssignments({ intervalMs: 20000 });

  const {
    data: forecastContext,
    status: forecastStatus,
    error: forecastError,
  } = useFloodForecast();

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');
  const [selectedAssignmentDetail, setSelectedAssignmentDetail] = useState<AssignmentRecord | null>(
    null,
  );
  // Route display mode: 'ROAD' (OSRM road network) vs 'DIRECT' (Straight-line direct transit vector)
  const [routeMode, setRouteMode] = useState<RouteMode>('ROAD');
  const [isPlanningAssignment, setIsPlanningAssignment] = useState(false);

  // Live fleet loading from authoritative DB
  const [liveFleet, setLiveFleet] = useState<StagedAsset[]>([]);

  useEffect(() => {
    let isCancelled = false;
    apiClient
      .listResources()
      .then((resList) => {
        if (isCancelled || !Array.isArray(resList)) return;
        const mapped: StagedAsset[] = resList.map((r) => ({
          id: r.id,
          name: r.name || r.id,
          type: r.type,
          capacity: r.capacity,
          speedKmH: r.speedKmH || (r.type === 'BOAT' ? 25 : 30),
          lat: r.lat,
          lng: r.lng,
          status: 'AVAILABLE',
          depotName: `${r.name || r.id} Depot`,
          source: r.source || 'REAL',
        }));
        setLiveFleet(mapped);
      })
      .catch(() => {
        // Fall back cleanly to static staged fleet
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const combinedFleet = useMemo(() => {
    const list = [...liveFleet];
    const existingIds = new Set(liveFleet.map((f) => f.id));
    for (const sf of STAGED_SECTOR_FLEET) {
      if (!existingIds.has(sf.id)) {
        list.push(sf);
      }
    }
    return list;
  }, [liveFleet]);

  // Combined shelters including dropoff shelters from active assignment
  const combinedShelters = useMemo(() => {
    const list = [...STAGED_SECTOR_SHELTERS];
    if (selectedAssignmentDetail?.routes) {
      for (const r of selectedAssignmentDetail.routes) {
        for (const s of r.stops || []) {
          if (s.type === 'DROPOFF' && !list.some((item) => item.id === s.targetId)) {
            list.push({
              id: s.targetId,
              name:
                s.targetId === 'sh_in_ncr_live_1'
                  ? 'Delhi Camp Live 1 (Relief Shelter)'
                  : `Shelter (${s.targetId})`,
              lat: s.lat,
              lng: s.lng,
              capacity: 100,
              availableBeds: 100,
              status: 'OPERATIONAL',
              source: 'REAL',
            });
          }
        }
      }
    }
    return list;
  }, [selectedAssignmentDetail]);

  // Resource type map for non-road vs road vehicle distinction
  const resourceTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    combinedFleet.forEach((f) => map.set(f.id, f.type));
    return map;
  }, [combinedFleet]);

  // Sync selected assignment initially
  useEffect(() => {
    if (assignments.length > 0 && !selectedAssignmentId) {
      setSelectedAssignmentId(assignments[0].id);
    }
  }, [assignments, selectedAssignmentId]);

  // Fetch full assignment details (including routes[] and Task B RouteGeometry) for the selected plan
  useEffect(() => {
    if (!selectedAssignmentId) {
      setSelectedAssignmentDetail(null);
      return;
    }

    const controller = new AbortController();
    apiClient
      .getAssignment(selectedAssignmentId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setSelectedAssignmentDetail(detail);
        }
      })
      .catch(() => {
        // Ignore aborts/errors; fall back cleanly to summary record
      });

    return () => {
      controller.abort();
    };
  }, [selectedAssignmentId, assignmentsUpdated]);

  const searchParams = useSearchParams();
  const requestedId = searchParams.get('requestId');
  const { selectedEntity, setSelectedEntity } = useMapSelection({ requests, requestedId });

  // Auto-associate assignment when an incident request is selected
  useEffect(() => {
    if (!selectedEntity || selectedEntity.type !== 'incident') return;
    const reqId = selectedEntity.item.id;

    const servesReq = (r: { servedRequestIds?: string[]; stops?: Array<{ targetId?: string }> }) =>
      Boolean(
        (r.servedRequestIds && r.servedRequestIds.includes(reqId)) ||
        (r.stops && r.stops.some((s) => s.targetId === reqId)),
      );

    const isRoadVehicle = (resId?: string) => {
      if (!resId) return false;
      const type = (resourceTypeMap.get(resId) || '').toUpperCase();
      return (
        type === 'HIGH_WATER_VEHICLE' ||
        type === 'AMBULANCE' ||
        type === 'TRUCK' ||
        resId === 'res_truck_ncr_1'
      );
    };

    const currentRoute = selectedAssignmentDetail?.routes?.find(servesReq);
    const currentServes = Boolean(currentRoute);
    const currentIsRoad = currentRoute ? isRoadVehicle(currentRoute.resourceId) : false;

    // If current detail already serves reqId, and in ROAD mode current is road vehicle, keep it
    if (currentServes && (routeMode !== 'ROAD' || currentIsRoad)) return;

    let isCancelled = false;
    const findAssignmentForRequest = async () => {
      for (const a of assignments) {
        if (a.id === selectedAssignmentId && currentServes) continue;
        try {
          const detail = await apiClient.getAssignment(a.id);
          if (isCancelled) return;
          const matchingRoute = detail.routes?.find(servesReq);
          if (matchingRoute) {
            const candidateIsRoad = isRoadVehicle(matchingRoute.resourceId);
            // In ROAD mode, if looking for road vehicle and candidate is not road, continue searching unless no road exists
            if (routeMode === 'ROAD' && !candidateIsRoad && currentServes) {
              continue;
            }
            setSelectedAssignmentId(a.id);
            setSelectedAssignmentDetail(detail);
            return;
          }
        } catch {
          // ignore lookup errors
        }
      }
    };

    findAssignmentForRequest();
    return () => {
      isCancelled = true;
    };
  }, [
    selectedEntity,
    assignments,
    selectedAssignmentId,
    selectedAssignmentDetail,
    routeMode,
    resourceTypeMap,
  ]);

  // Switch to road mode and retry fetching geometry
  const handleSwitchToRoadMode = useCallback(async () => {
    setRouteMode('ROAD');
    if (selectedAssignmentId) {
      try {
        const detail = await apiClient.getAssignment(selectedAssignmentId);
        setSelectedAssignmentDetail(detail);
      } catch {
        // ignore
      }
    }
  }, [selectedAssignmentId]);

  // Propose an assignment from the map for unassigned incidents
  const handlePlanAssignment = useCallback(async () => {
    setIsPlanningAssignment(true);
    try {
      const proposed = await apiClient.proposeAssignment({
        algorithm: 'cluster-allocation',
        includeUnverified: true,
      });
      await refreshAssignments();
      if (proposed?.id) {
        setSelectedAssignmentId(proposed.id);
        setSelectedAssignmentDetail(proposed);
      }
    } catch (err) {
      console.error('Failed to plan assignment:', err);
    } finally {
      setIsPlanningAssignment(false);
    }
  }, [refreshAssignments]);

  // Aggregate live status
  const liveStatus: LivePollingStatus =
    requestsStatus === 'OFFLINE' || assignmentsStatus === 'OFFLINE'
      ? 'OFFLINE'
      : requestsStatus === 'UNAUTHORIZED' || assignmentsStatus === 'UNAUTHORIZED'
        ? 'UNAUTHORIZED'
        : requestsStatus === 'FORBIDDEN' || assignmentsStatus === 'FORBIDDEN'
          ? 'FORBIDDEN'
          : requestsStatus === 'REFRESHING' || assignmentsStatus === 'REFRESHING'
            ? 'REFRESHING'
            : requestsStatus === 'STALE' || assignmentsStatus === 'STALE'
              ? 'STALE'
              : requestsStatus === 'INITIAL_LOADING' || assignmentsStatus === 'INITIAL_LOADING'
                ? 'INITIAL_LOADING'
                : 'UP_TO_DATE';

  const lastUpdated = requestsUpdated || assignmentsUpdated;
  const isRefreshing = requestsRefreshing || assignmentsRefreshing;

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshRequests(), refreshAssignments()]);
  }, [refreshRequests, refreshAssignments]);

  // Layers and filters
  const [layers, setLayers] = useState<MapLayers>({
    incidents: true,
    craft: true,
    shelters: true,
    routes: true,
    blockages: true,
    repairOverlay: false,
    floodForecast: false,
  });

  // Master layer visibility state: controls simultaneous overlay show/hide while preserving individual layer preferences
  const [masterVisible, setMasterVisible] = useState<boolean>(true);

  // Overlays are considered visible when masterVisible is true and at least one individual layer is enabled
  const hasAnyLayerEnabled = useMemo(() => Object.values(layers).some(Boolean), [layers]);
  const masterOverlaysVisible = masterVisible && hasAnyLayerEnabled;

  // Effective layer map passed to Leaflet canvas and contextual overlay cards
  const effectiveLayers = useMemo<MapLayers>(() => {
    if (!masterOverlaysVisible) {
      return {
        incidents: false,
        craft: false,
        shelters: false,
        routes: false,
        blockages: false,
        repairOverlay: false,
        floodForecast: false,
      };
    }
    return layers;
  }, [masterOverlaysVisible, layers]);

  // Master toggle handler: switches between "Hide All Layers" and "Show All Layers"
  const toggleAllLayers = useCallback(() => {
    if (masterOverlaysVisible) {
      setMasterVisible(false);
    } else {
      setMasterVisible(true);
      // If all individual layers happen to be false, restore standard default active layers
      setLayers((prev) => {
        const hasAny = Object.values(prev).some(Boolean);
        if (!hasAny) {
          return {
            incidents: true,
            craft: true,
            shelters: true,
            routes: true,
            blockages: true,
            repairOverlay: false,
            floodForecast: false,
          };
        }
        return prev;
      });
    }
  }, [masterOverlaysVisible]);

  const [urgencyFilter, setUrgencyFilter] = useState<'ALL' | UrgencyLevel>('ALL');
  // Light Google-like Standard OSM is the default basemap; Dark Tactical remains selectable.
  const [tileTheme, setTileTheme] = useState<'dark' | 'standard'>('standard');
  const isLight = tileTheme === 'standard';
  const hudCardClass = isLight
    ? 'bg-white/95 backdrop-blur-md border border-slate-200 text-slate-800 shadow-lg'
    : 'bg-slate-900/95 backdrop-blur-md border border-slate-700/80 text-slate-100 shadow-2xl';

  // Map control trigger for programmatic movement
  const [actionTrigger, setActionTrigger] = useState<{
    type: 'fit' | 'center-critical' | 'zoom-in' | 'zoom-out';
    id: number;
  } | null>(null);

  const triggerAction = (type: 'fit' | 'center-critical' | 'zoom-in' | 'zoom-out') => {
    setActionTrigger({ type, id: Date.now() });
  };

  const toggleLayer = (layer: keyof MapLayers) => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  };

  // Real repair proposals / assignments recorded in the dispatch database
  const repairAssignments = useMemo(() => {
    return assignments.filter(isRepairAssignment);
  }, [assignments]);

  const [selectedRepairAssignmentId, setSelectedRepairAssignmentId] = useState<string>('');
  const [selectedRepairAssignmentDetail, setSelectedRepairAssignmentDetail] =
    useState<AssignmentRecord | null>(null);
  const [activeRepairRouteIndex, setActiveRepairRouteIndex] = useState<number>(0);

  // Sync selected repair assignment
  useEffect(() => {
    if (repairAssignments.length > 0) {
      if (
        !selectedRepairAssignmentId ||
        !repairAssignments.some((r) => r.id === selectedRepairAssignmentId)
      ) {
        setSelectedRepairAssignmentId(repairAssignments[0].id);
        setActiveRepairRouteIndex(0);
      }
    } else {
      setSelectedRepairAssignmentId('');
      setSelectedRepairAssignmentDetail(null);
      setActiveRepairRouteIndex(0);
    }
  }, [repairAssignments, selectedRepairAssignmentId]);

  // Fetch full hydrated assignment details (including OSRM route geometries) for the repair proposal
  useEffect(() => {
    if (!selectedRepairAssignmentId) {
      setSelectedRepairAssignmentDetail(null);
      return;
    }

    const controller = new AbortController();
    apiClient
      .getAssignment(selectedRepairAssignmentId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setSelectedRepairAssignmentDetail(detail);
        }
      })
      .catch(() => {
        // ignore aborts or errors
      });

    return () => {
      controller.abort();
    };
  }, [selectedRepairAssignmentId, assignmentsUpdated]);

  const selectedRepairAssignmentSummary = useMemo(() => {
    return (
      repairAssignments.find((a) => a.id === selectedRepairAssignmentId) ||
      repairAssignments[0] ||
      null
    );
  }, [repairAssignments, selectedRepairAssignmentId]);

  const selectedRepairAssignment = useMemo(() => {
    if (
      selectedRepairAssignmentDetail &&
      selectedRepairAssignmentDetail.id === selectedRepairAssignmentId
    ) {
      return selectedRepairAssignmentDetail;
    }
    return selectedRepairAssignmentSummary;
  }, [selectedRepairAssignmentDetail, selectedRepairAssignmentId, selectedRepairAssignmentSummary]);

  const activeRepairRoute = useMemo(() => {
    if (!selectedRepairAssignment?.routes || selectedRepairAssignment.routes.length === 0) {
      return null;
    }
    return (
      selectedRepairAssignment.routes[activeRepairRouteIndex] ||
      selectedRepairAssignment.routes[0] ||
      null
    );
  }, [selectedRepairAssignment, activeRepairRouteIndex]);

  const activeRepairRouteMetrics = useMemo(() => {
    if (!activeRepairRoute) return null;
    return getRouteDisplayMetrics(activeRepairRoute, routeMode, undefined, resourceTypeMap);
  }, [activeRepairRoute, routeMode, resourceTypeMap]);

  const activeRepairStops = useMemo(() => {
    if (!activeRepairRoute) return [];
    return extractRepairStops(activeRepairRoute);
  }, [activeRepairRoute]);

  // Selected assignment record (prefer hydrated detail with Task B routes & RouteGeometry)
  const selectedAssignmentSummary = useMemo(() => {
    return assignments.find((a) => a.id === selectedAssignmentId) || assignments[0] || null;
  }, [assignments, selectedAssignmentId]);

  const selectedAssignment = useMemo(() => {
    if (selectedAssignmentDetail && selectedAssignmentDetail.id === selectedAssignmentId) {
      return selectedAssignmentDetail;
    }
    return selectedAssignmentSummary;
  }, [selectedAssignmentDetail, selectedAssignmentId, selectedAssignmentSummary]);

  // Route serving the focused incident
  const activeRouteForIncident = useMemo(() => {
    if (selectedEntity?.type !== 'incident' || !selectedAssignment?.routes) return null;
    const reqId = selectedEntity.item.id;
    return (
      selectedAssignment.routes.find(
        (r) =>
          (r.servedRequestIds && r.servedRequestIds.includes(reqId)) ||
          (r.stops && r.stops.some((s) => s.targetId === reqId)),
      ) ?? null
    );
  }, [selectedEntity, selectedAssignment]);

  const activeRouteMetrics = useMemo(() => {
    if (!activeRouteForIncident) return null;
    return getRouteDisplayMetrics(activeRouteForIncident, routeMode, undefined, resourceTypeMap);
  }, [activeRouteForIncident, routeMode, resourceTypeMap]);

  const assignedResource = useMemo(() => {
    if (!activeRouteForIncident) return null;
    return combinedFleet.find((f) => f.id === activeRouteForIncident.resourceId) || null;
  }, [activeRouteForIncident, combinedFleet]);

  const assignedResourceName =
    assignedResource?.name ||
    (activeRouteForIncident?.resourceId === 'res_truck_ncr_1'
      ? 'Delhi Rescue Truck 1'
      : activeRouteForIncident?.resourceId || null);

  const assignedResourceType =
    assignedResource?.type ||
    (activeRouteForIncident?.resourceId
      ? resourceTypeMap.get(activeRouteForIncident.resourceId)
      : null) ||
    'HIGH_WATER_VEHICLE';

  const routeSummary = useMemo(
    () => summarizeAssignmentRoutes(selectedAssignment?.routes ?? [], routeMode, resourceTypeMap),
    [selectedAssignment, routeMode, resourceTypeMap],
  );

  const hasUnavailableRoadSegments = routeSummary.hasUnavailableRoadSegments;

  // Filtered requests count
  const filteredRequestsCount = useMemo(() => {
    return requests.filter((r) => {
      if (urgencyFilter !== 'ALL' && r.urgency !== urgencyFilter) return false;
      return true;
    }).length;
  }, [requests, urgencyFilter]);

  return (
    <div
      className={`flex flex-col h-[calc(100vh-3.5rem)] relative overflow-hidden select-none ${
        isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#0b1320] text-slate-100'
      }`}
    >
      {/* Top Banner Notice: Sector Status & Live Timestamp */}
      <div
        className={`px-4 py-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs z-30 shrink-0 ${
          isLight
            ? 'bg-white border-b border-slate-200 text-slate-800'
            : 'bg-slate-900/95 border-b border-slate-700/60 text-slate-200'
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className={`font-semibold ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
            {MAP_SCENARIO_NAME}
          </span>
          <span className="text-slate-400 hidden sm:inline">•</span>
          <span
            className={`font-mono text-[11px] hidden md:inline ${
              isLight ? 'text-slate-500' : 'text-slate-400'
            }`}
          >
            {MAP_SCENARIO_COORDINATES}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold flex items-center gap-1.5 border ${
              isLight
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-emerald-900/40 text-emerald-300 border-emerald-600/50'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            LIVE INCIDENTS • REFERENCE FLEET & HAZARDS
          </span>
          <LiveStatusIndicator
            status={liveStatus}
            lastUpdated={lastUpdated}
            onRefresh={refreshAll}
            isRefreshing={isRefreshing}
          />
        </div>
      </div>

      {/* Main Map Canvas and Inspector Workspace */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* MAP CANVAS */}
        <div
          className={`flex-1 relative h-full overflow-hidden ${
            isLight ? 'bg-[#e8eef5]' : 'bg-[#0b1320]'
          }`}
        >
          {/* Top-left Floating Layer & Filter Controls */}
          <div className="absolute top-3 left-3 z-20 flex flex-col gap-2 max-w-2xl">
            {/* Layer Checkbox Group & Master Visibility Toggle */}
            <div
              className={`${hudCardClass} p-2.5 rounded-xl flex flex-col gap-2 text-xs`}
              data-testid="map-layer-control-panel"
            >
              {/* Master Layer Visibility Header / Toggle Button */}
              <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200/80 dark:border-slate-700/60">
                <div className="flex items-center gap-1.5 font-bold font-mono text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  <span className="material-symbols-outlined text-[16px] text-blue-600 dark:text-blue-400">
                    layers
                  </span>
                  <span>Map Overlays</span>
                </div>
                <button
                  type="button"
                  data-testid="master-layer-toggle-btn"
                  onClick={toggleAllLayers}
                  aria-label={masterOverlaysVisible ? 'Hide All Layers' : 'Show All Layers'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold text-xs transition-all shadow-sm ${
                    masterOverlaysVisible
                      ? isLight
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600'
                      : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-500 shadow-blue-500/20'
                  }`}
                  title={
                    masterOverlaysVisible
                      ? 'Hide all map overlays while preserving layer preferences'
                      : 'Show all previously enabled map overlays'
                  }
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {masterOverlaysVisible ? 'visibility_off' : 'visibility'}
                  </span>
                  <span>{masterOverlaysVisible ? 'Hide All Layers' : 'Show All Layers'}</span>
                </button>
              </div>

              {/* Individual Layer Checkboxes */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Incidents Layer */}
                <label
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors ${
                    isLight
                      ? 'bg-red-50 border-red-200 text-red-900 hover:bg-red-100/70'
                      : 'bg-red-950/40 border-red-500/40 text-slate-100 hover:bg-red-900/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={layers.incidents}
                    onChange={() => toggleLayer('incidents')}
                    className="rounded text-red-600 focus:ring-0 w-3.5 h-3.5 bg-transparent border-red-400 cursor-pointer"
                  />
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-medium">Distress Incidents</span>
                  <span className="ml-0.5 px-1.5 py-0.2 rounded bg-red-600 text-white font-mono text-[10px] font-bold">
                    {filteredRequestsCount}
                  </span>
                </label>

                {/* Craft Layer (Reference) */}
                <label
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors ${
                    isLight
                      ? 'bg-teal-50 border-teal-200 text-teal-900 hover:bg-teal-100/70'
                      : 'bg-teal-950/40 border-teal-500/40 text-slate-100 hover:bg-teal-900/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={layers.craft}
                    onChange={() => toggleLayer('craft')}
                    className="rounded text-teal-600 focus:ring-0 w-3.5 h-3.5 bg-transparent border-teal-500 cursor-pointer"
                  />
                  <span className="material-symbols-outlined text-[14px] text-teal-600">
                    directions_boat
                  </span>
                  <span className="font-medium">Reference Fleet</span>
                  <span className="ml-0.5 px-1.5 py-0.2 rounded bg-teal-700 text-white font-mono text-[10px] font-bold">
                    {STAGED_SECTOR_FLEET.length}
                  </span>
                </label>

                {/* Shelters Layer (Reference) */}
                <label
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors ${
                    isLight
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100/70'
                      : 'bg-emerald-950/40 border-emerald-500/40 text-slate-100 hover:bg-emerald-900/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={layers.shelters}
                    onChange={() => toggleLayer('shelters')}
                    className="rounded text-emerald-600 focus:ring-0 w-3.5 h-3.5 bg-transparent border-emerald-500 cursor-pointer"
                  />
                  <span className="material-symbols-outlined text-[14px] text-emerald-600">
                    night_shelter
                  </span>
                  <span className="font-medium">Relief Shelters</span>
                  <span className="ml-0.5 px-1.5 py-0.2 rounded bg-emerald-700 text-white font-mono text-[10px] font-bold">
                    {STAGED_SECTOR_SHELTERS.length}
                  </span>
                </label>

                {/* Assignment Routes Layer */}
                <label
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors ${
                    isLight
                      ? 'bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100/70'
                      : 'bg-sky-950/40 border-sky-500/40 text-slate-100 hover:bg-sky-900/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={layers.routes}
                    onChange={() => toggleLayer('routes')}
                    className="rounded text-blue-600 focus:ring-0 w-3.5 h-3.5 bg-transparent border-blue-500 cursor-pointer"
                  />
                  <span className="material-symbols-outlined text-[14px] text-blue-600">route</span>
                  <span className="font-medium">Routes</span>
                </label>

                {/* Road Hazard Blockages Layer (Reference) */}
                <label
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors ${
                    isLight
                      ? 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100/70'
                      : 'bg-rose-950/40 border-rose-500/40 text-slate-100 hover:bg-rose-900/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={layers.blockages}
                    onChange={() => toggleLayer('blockages')}
                    className="rounded text-rose-600 focus:ring-0 w-3.5 h-3.5 bg-transparent border-rose-500 cursor-pointer"
                  />
                  <span className="material-symbols-outlined text-[14px] text-rose-600">
                    traffic
                  </span>
                  <span className="font-medium">Hazard Zones</span>
                  <span className="ml-0.5 px-1.5 py-0.2 rounded bg-rose-700 text-white font-mono text-[10px] font-bold">
                    {STAGED_SECTOR_BLOCKED_ZONES.length}
                  </span>
                </label>

                {/* Repair Comparison Overlay */}
                <label
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors ${
                    isLight
                      ? 'bg-purple-50 border-purple-200 text-purple-900 hover:bg-purple-100/70'
                      : 'bg-purple-950/40 border-purple-500/40 text-slate-100 hover:bg-purple-900/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={layers.repairOverlay}
                    onChange={() => toggleLayer('repairOverlay')}
                    className="rounded text-purple-600 focus:ring-0 w-3.5 h-3.5 bg-transparent border-purple-500 cursor-pointer"
                  />
                  <span className="material-symbols-outlined text-[14px] text-purple-600">
                    alt_route
                  </span>
                  <span className="font-medium">Repair Overlay</span>
                </label>

                {/* Flood Forecast Context Layer (Phase 6) */}
                <label
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-cyan-950/40 border border-cyan-500/40 text-slate-100 cursor-pointer hover:bg-cyan-900/40 transition-colors"
                  data-testid="layer-toggle-forecast"
                >
                  <input
                    type="checkbox"
                    checked={layers.floodForecast}
                    onChange={() => toggleLayer('floodForecast')}
                    className="rounded text-cyan-400 focus:ring-0 w-3.5 h-3.5 bg-transparent border-cyan-400 cursor-pointer"
                  />
                  <span className="material-symbols-outlined text-[14px] text-cyan-400">waves</span>
                  <span className="font-medium">Flood Forecast</span>
                  {forecastContext && (
                    <span
                      className={`ml-0.5 px-1.5 py-0.2 rounded text-white font-mono text-[10px] font-bold ${
                        forecastContext.freshness === 'UNAVAILABLE'
                          ? 'bg-slate-700 text-slate-300'
                          : forecastContext.freshness === 'OFFLINE_FIXTURE'
                            ? 'bg-amber-800 text-amber-200'
                            : 'bg-cyan-800 text-white'
                      }`}
                    >
                      {forecastContext.freshness === 'UNAVAILABLE'
                        ? 'UNAVAILABLE'
                        : `${forecastContext.currentDischargeM3S} m³/s`}
                    </span>
                  )}
                </label>
              </div>
            </div>

            {/* Flood Forecast Information Floating Card */}
            {effectiveLayers.floodForecast && (
              <div
                className="bg-slate-900/95 backdrop-blur-md border border-cyan-500/60 p-3 rounded-xl shadow-2xl space-y-2 text-xs text-slate-200 animate-in fade-in"
                data-testid="forecast-info-card"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-700/60 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-cyan-400 text-base">waves</span>
                    <span className="font-bold text-slate-100">
                      Yamuna River Discharge Forecast
                    </span>
                  </div>
                  {forecastContext && (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        forecastContext.freshness === 'OFFLINE_FIXTURE'
                          ? 'bg-amber-950 border-amber-500 text-amber-300'
                          : forecastContext.freshness === 'UNAVAILABLE'
                            ? 'bg-slate-800 border-slate-600 text-slate-300'
                            : 'bg-cyan-950 border-cyan-500/50 text-cyan-300'
                      }`}
                    >
                      {forecastContext.freshness === 'OFFLINE_FIXTURE'
                        ? 'SIMULATED FORECAST — DEMO ONLY'
                        : `${forecastContext.riskCategory} • ${forecastContext.freshness}`}
                    </span>
                  )}
                </div>

                {forecastStatus === 'ERROR' ||
                (!forecastContext && forecastError) ||
                (forecastContext && forecastContext.freshness === 'UNAVAILABLE') ? (
                  <div className="text-amber-300 text-[11px] bg-amber-950/40 border border-amber-600/40 p-2 rounded">
                    Forecast Unavailable: Upstream hydrological provider unreachable and no cached
                    data exists. Operational rescue map and routing remain fully interactive.
                  </div>
                ) : forecastContext ? (
                  <div className="space-y-1.5">
                    {forecastContext.freshness === 'OFFLINE_FIXTURE' && (
                      <div className="p-1.5 bg-amber-950/60 border border-amber-500/60 rounded text-[10px] text-amber-200 font-semibold text-center uppercase tracking-wide">
                        ⚠ DEMO ENVIRONMENT: Displaying synthetic offline fixture
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
                        <div className="text-[10px] text-slate-400 uppercase font-mono">
                          Current Discharge
                        </div>
                        <div className="text-sm font-bold font-mono text-cyan-300 mt-0.5">
                          {forecastContext.currentDischargeM3S} {forecastContext.variable.unit}
                        </div>
                      </div>
                      <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
                        <div className="text-[10px] text-slate-400 uppercase font-mono">
                          7-Day Peak Forecast
                        </div>
                        <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">
                          {forecastContext.peakForecastM3S} {forecastContext.variable.unit}
                        </div>
                      </div>
                    </div>

                    <div className="text-[10.5px] text-slate-400 font-mono">
                      Cell: Lat {forecastContext.region.stationLat.toFixed(3)}°N, Lng{' '}
                      {forecastContext.region.stationLng.toFixed(3)}°E • Issued:{' '}
                      {forecastContext.issuedAt.split('T')[0]}
                    </div>

                    <div className="text-[9.5px] text-slate-400 italic border-t border-slate-800 pt-1 leading-tight">
                      <span className="font-semibold text-slate-300">Model Indicator:</span>{' '}
                      {forecastContext.attribution}. {forecastContext.disclaimer}
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400 text-[11px]">Loading hydrological context...</div>
                )}
              </div>
            )}

            {/* Repair Route Overlay: Empty State Notice */}
            {effectiveLayers.repairOverlay && repairAssignments.length === 0 && (
              <div
                className={`p-3 rounded-xl shadow-xl flex items-center gap-3 text-xs ${hudCardClass} animate-in fade-in border-blue-500/40`}
                data-testid="repair-empty-state-notice"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-700/50 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-lg">
                    build_circle
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold font-mono text-[11px] uppercase tracking-wider text-blue-700 dark:text-blue-400">
                      Repair Route Overlay
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-300 dark:border-slate-700">
                      0 Active
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 text-xs mt-0.5">
                    No active repair routes. Repair assignments will appear here when available.
                  </p>
                </div>
              </div>
            )}

            {/* Repair Route Overlay: Google Maps-Style Route Information Panel */}
            {effectiveLayers.repairOverlay &&
              repairAssignments.length > 0 &&
              selectedRepairAssignment && (
                <div
                  className={`p-3.5 rounded-xl shadow-2xl space-y-2.5 text-xs ${hudCardClass} animate-in fade-in border-blue-500/60 max-w-md w-full`}
                  data-testid="repair-route-panel"
                >
                  {/* Header: Title, Status, and Selectors */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/70 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-lg">
                        navigation
                      </span>
                      <div>
                        <span className="font-bold font-mono text-[12px] text-blue-700 dark:text-blue-400">
                          Repair Route Navigation
                        </span>
                        <div className="text-[10px] text-slate-500 font-mono">
                          Plan: {selectedRepairAssignment.id}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-700">
                        {selectedRepairAssignment.status}
                      </span>
                    </div>
                  </div>

                  {/* Multiple Repair Proposals Selector (if > 1) */}
                  {repairAssignments.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase font-bold text-slate-500">
                        Plan:
                      </span>
                      <select
                        value={selectedRepairAssignmentId}
                        onChange={(e) => setSelectedRepairAssignmentId(e.target.value)}
                        className={`flex-1 rounded border px-2 py-1 text-xs font-semibold ${
                          isLight
                            ? 'bg-slate-50 border-slate-300 text-slate-800'
                            : 'bg-slate-800 border-slate-700 text-slate-100'
                        }`}
                      >
                        {repairAssignments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.id} ({a.routes?.length || 0} route(s))
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Multiple Routes Selector (if > 1) */}
                  {(selectedRepairAssignment.routes?.length ?? 0) > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      <span className="font-mono text-[10px] uppercase font-bold text-slate-500 shrink-0">
                        Route:
                      </span>
                      {selectedRepairAssignment.routes!.map((r, rIdx) => (
                        <button
                          key={`repair-tab-${r.resourceId}-${rIdx}`}
                          onClick={() => setActiveRepairRouteIndex(rIdx)}
                          className={`px-2 py-1 rounded text-xs font-mono font-semibold transition-all shrink-0 ${
                            rIdx === activeRepairRouteIndex
                              ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-400'
                              : isLight
                                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                          }`}
                        >
                          {r.resourceId} (#{rIdx + 1})
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Active Repair Route Telemetry Bar */}
                  {activeRepairRoute && activeRepairRouteMetrics && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/50">
                        <div>
                          <div className="text-[10px] text-slate-500 font-mono uppercase">
                            Unit:{' '}
                            <span className="font-bold text-blue-700 dark:text-blue-300">
                              {activeRepairRoute.resourceId}
                            </span>
                          </div>
                          <div className="font-mono text-sm font-bold text-blue-900 dark:text-blue-100">
                            {formatDistanceKm(activeRepairRouteMetrics.distanceKm)} •{' '}
                            {formatDurationMinutes(activeRepairRouteMetrics.durationMinutes)}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 shadow-sm">
                            {routeMode === 'ROAD' ? 'OSRM Road' : 'Direct / Air'}
                          </span>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {activeRepairRoute.stops?.length ?? 0} Stops
                          </div>
                        </div>
                      </div>

                      {/* Road Route Unavailable Warning if OSRM failed */}
                      {routeMode === 'ROAD' &&
                        activeRepairRouteMetrics.hasUnavailableRoadSegments && (
                          <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-200 text-xs space-y-1">
                            <div className="font-bold flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[15px] text-amber-600">
                                warning
                              </span>
                              <span>Road Route Geometry Unavailable</span>
                            </div>
                            <p className="text-[11px] leading-tight text-amber-900/90 dark:text-amber-300/90">
                              OSRM road network routing could not calculate a valid road route for
                              this repair segment.
                            </p>
                            <button
                              onClick={() => setRouteMode('DIRECT')}
                              className="mt-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-mono text-[11px] font-bold transition-colors shadow-sm"
                            >
                              Switch to Direct / Air Mode
                            </button>
                          </div>
                        )}

                      {/* Ordered Stops List */}
                      {activeRepairStops.length > 0 && (
                        <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                          <span className="font-mono text-[10px] uppercase font-bold text-slate-500">
                            Ordered Repair Sequence:
                          </span>
                          <div className="space-y-1">
                            {activeRepairStops.map((stop, sIdx) => (
                              <div
                                key={`stop-row-${sIdx}-${stop.targetId}`}
                                className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white/60 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 text-[11px]"
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  {stop.isStart ? (
                                    <span className="w-4 h-4 rounded-full bg-emerald-600 text-white font-mono font-bold text-[9px] flex items-center justify-center shrink-0">
                                      A
                                    </span>
                                  ) : stop.isEnd ? (
                                    <span className="w-4 h-4 rounded-full bg-rose-600 text-white font-mono font-bold text-[9px] flex items-center justify-center shrink-0">
                                      B
                                    </span>
                                  ) : (
                                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white font-mono font-bold text-[9px] flex items-center justify-center shrink-0">
                                      {stop.stopNumber}
                                    </span>
                                  )}
                                  <span className="font-mono text-slate-800 dark:text-slate-200 truncate">
                                    {stop.label}
                                  </span>
                                </div>
                                {stop.estimatedArrivalMinutes !== undefined && (
                                  <span className="font-mono text-[10px] text-slate-500 shrink-0">
                                    ~{Math.round(stop.estimatedArrivalMinutes)} min
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            {/* Filter Dropdowns, Assignment Plan Selector, Route Telemetry & Tile Theme */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Urgency Filter */}
              <div className={`flex items-center ${hudCardClass} rounded-lg px-2.5 py-1 text-xs`}>
                <span
                  className={`mr-1.5 font-mono text-[10px] uppercase font-bold ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  Urgency:
                </span>
                <select
                  value={urgencyFilter}
                  onChange={(e) => setUrgencyFilter(e.target.value as 'ALL' | UrgencyLevel)}
                  className={`bg-transparent border-0 p-0 pr-4 text-xs font-semibold focus:ring-0 cursor-pointer ${
                    isLight ? 'text-slate-800' : 'text-slate-200'
                  }`}
                >
                  <option
                    value="ALL"
                    className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-slate-100'}
                  >
                    All Urgencies ({requests.length})
                  </option>
                  <option
                    value="CRITICAL"
                    className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-slate-100'}
                  >
                    Critical Only
                  </option>
                  <option
                    value="HIGH"
                    className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-slate-100'}
                  >
                    High Only
                  </option>
                  <option
                    value="MEDIUM"
                    className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-slate-100'}
                  >
                    Medium Only
                  </option>
                  <option
                    value="LOW"
                    className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-slate-100'}
                  >
                    Low Only
                  </option>
                </select>
              </div>

              {/* Active Assignment Plan Selector */}
              {assignments.length > 0 && (
                <div className={`flex items-center ${hudCardClass} rounded-lg px-2.5 py-1 text-xs`}>
                  <span
                    className={`mr-1.5 font-mono text-[10px] uppercase font-bold ${
                      isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}
                  >
                    Plan:
                  </span>
                  <select
                    value={selectedAssignment?.id ?? selectedAssignmentId}
                    onChange={(e) => setSelectedAssignmentId(e.target.value)}
                    className={`bg-transparent border-0 p-0 pr-4 text-xs font-semibold focus:ring-0 cursor-pointer max-w-[180px] truncate ${
                      isLight ? 'text-slate-800' : 'text-slate-200'
                    }`}
                  >
                    {assignments.map((a) => (
                      <option
                        key={a.id}
                        value={a.id}
                        className={
                          isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-slate-100'
                        }
                      >
                        {a.id} ({a.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Route Mode Selector (Road Route vs Direct / Air) */}
              <div
                className={`flex items-center ${hudCardClass} rounded-lg p-0.5 text-xs shadow-sm`}
                role="group"
                aria-label="Route Mode Selector"
              >
                <button
                  type="button"
                  data-testid="route-mode-road-btn"
                  onClick={() => handleSwitchToRoadMode()}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                    routeMode === 'ROAD'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-600 hover:text-slate-900'
                        : 'text-slate-300 hover:text-white'
                  }`}
                  title="Road Route Mode: Follows real OSRM road network geometry."
                >
                  <span className="material-symbols-outlined text-[14px]">directions_car</span>
                  <span>Road Route</span>
                </button>
                <button
                  type="button"
                  data-testid="route-mode-direct-btn"
                  onClick={() => setRouteMode('DIRECT')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                    routeMode === 'DIRECT'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-600 hover:text-slate-900'
                        : 'text-slate-300 hover:text-white'
                  }`}
                  title="Direct / Air Mode: Shows straight-line transit vectors between stops."
                >
                  <span className="material-symbols-outlined text-[14px]">airplanemode_active</span>
                  <span>Direct / Air</span>
                </button>
              </div>

              {/* Tile Style Toggle (Light Standard OSM Default / Dark Tactical Option) */}
              <button
                type="button"
                onClick={() => setTileTheme((t) => (t === 'dark' ? 'standard' : 'dark'))}
                className={`flex items-center gap-1 ${hudCardClass} rounded-lg px-2.5 py-1 text-xs transition-colors ${
                  isLight ? 'hover:bg-slate-50 text-slate-700' : 'hover:text-white text-slate-300'
                }`}
                title="Toggle OpenStreetMap Tile Theme"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {tileTheme === 'dark' ? 'dark_mode' : 'light_mode'}
                </span>
                <span className="font-mono text-[10px] font-semibold">
                  {tileTheme === 'dark' ? 'DARK TACTICAL' : 'STANDARD OSM'}
                </span>
              </button>

              {/* Route Distance / Duration Summary Badge */}
              {routeSummary.routeCount > 0 && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold border ${
                    isLight
                      ? 'bg-blue-50/95 border-blue-200 text-blue-900 shadow-lg'
                      : 'bg-sky-950/90 border-sky-500/50 text-sky-200 shadow-xl'
                  }`}
                  data-testid="route-summary-badge"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {routeMode === 'DIRECT' ? 'airplanemode_active' : 'directions_car'}
                  </span>
                  <span>
                    {activeRouteMetrics
                      ? `Route (${activeRouteForIncident?.resourceId}) • ${formatDistanceKm(activeRouteMetrics.distanceKm)} • ${formatDurationMinutes(activeRouteMetrics.durationMinutes)} • ${getRouteSourceLabel(activeRouteMetrics.source, routeMode)}`
                      : `${routeSummary.routeCount} Route(s) • ${formatDistanceKm(routeSummary.totalDistanceKm)} • ${formatDurationMinutes(routeSummary.totalDurationMinutes)} • ${getRouteSourceLabel(routeSummary.overallSource, routeMode)}`}
                  </span>
                </div>
              )}
            </div>

            {/* Road Route Unavailable Notice Banner with Direct Switch Action */}
            {routeMode === 'ROAD' && hasUnavailableRoadSegments && (
              <div
                data-testid="road-route-unavailable-banner"
                className="bg-amber-500/10 border border-amber-500/50 text-amber-900 dark:text-amber-100 rounded-xl p-3 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg backdrop-blur-md animate-in fade-in max-w-xl"
              >
                <div className="flex items-start sm:items-center gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-lg flex-shrink-0 mt-0.5 sm:mt-0">
                    warning
                  </span>
                  <div>
                    <p className="font-semibold text-amber-900 dark:text-amber-100 leading-snug">
                      Road route unavailable. OSRM could not calculate a valid road route for this
                      segment. Switch to Direct / Air mode to view a straight-line estimate.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="switch-to-direct-air-btn"
                  onClick={() => setRouteMode('DIRECT')}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-semibold rounded-lg text-xs transition-colors whitespace-nowrap shadow-sm flex items-center gap-1 shrink-0 self-end sm:self-center"
                >
                  <span>Switch to Direct / Air Route</span>
                  <span aria-hidden="true">&rarr;</span>
                </button>
              </div>
            )}

            {/* Direct / Air Mode Active Banner with Switch Back to Road Action */}
            {routeMode === 'DIRECT' && (
              <div
                data-testid="direct-air-active-banner"
                className="bg-sky-500/10 border border-sky-500/40 text-sky-900 dark:text-sky-100 rounded-xl p-2.5 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-lg backdrop-blur-md animate-in fade-in max-w-xl"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[10px] tracking-wider uppercase px-1.5 py-0.5 rounded bg-sky-200 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200 shrink-0">
                    DIRECT / AIR MODE
                  </span>
                  <span>
                    Direct / Air-style straight-line transit vectors shown. Connecting route stops
                    via straight-line geographic estimates.
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="switch-to-road-route-btn"
                  onClick={() => handleSwitchToRoadMode()}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-xs transition-colors whitespace-nowrap shadow-sm shrink-0 self-end sm:self-center"
                >
                  Switch to Road Route
                </button>
              </div>
            )}
          </div>

          {/* Top Center Dynamic Route Geometry Banner */}
          <div className="absolute top-3 right-16 z-20 pointer-events-none max-w-sm hidden xl:block">
            <div className={`${hudCardClass} px-3 py-1.5 rounded-xl flex items-center gap-2`}>
              <span
                className={`material-symbols-outlined text-sm flex-shrink-0 ${
                  routeMode === 'DIRECT'
                    ? 'text-sky-500'
                    : (activeRouteMetrics?.source ?? routeSummary.overallSource) === 'OSRM'
                      ? 'text-blue-600'
                      : (activeRouteMetrics?.source ?? routeSummary.overallSource) === 'MIXED'
                        ? 'text-sky-600'
                        : 'text-amber-500'
                }`}
              >
                {routeMode === 'DIRECT'
                  ? 'airplanemode_active'
                  : (activeRouteMetrics?.source ?? routeSummary.overallSource) === 'STRAIGHT_LINE'
                    ? 'info'
                    : 'alt_route'}
              </span>
              <p
                className={`text-[11px] leading-tight ${isLight ? 'text-slate-600' : 'text-slate-300'}`}
              >
                <strong
                  className={`font-semibold ${isLight ? 'text-slate-900' : 'text-amber-300'}`}
                >
                  {routeMode === 'DIRECT'
                    ? 'Direct / Air-style transit vectors shown.'
                    : activeRouteMetrics?.source === 'OSRM' ||
                        (routeSummary.routeCount > 0 && routeSummary.overallSource === 'OSRM')
                      ? 'OSRM road-following routes active.'
                      : routeSummary.routeCount > 0 && routeSummary.overallSource === 'MIXED'
                        ? 'Mixed road + straight-line routes shown.'
                        : 'Straight-line transit vectors shown.'}
                </strong>{' '}
                {routeMode === 'DIRECT'
                  ? 'Connecting stops via direct straight-line geographic vectors (no road navigation).'
                  : activeRouteMetrics?.source === 'OSRM' ||
                      (routeSummary.routeCount > 0 && routeSummary.overallSource === 'OSRM')
                    ? 'Road vehicles follow OpenStreetMap streets; watercraft and air units stay straight-line.'
                    : routeSummary.overallSource === 'STRAIGHT_LINE'
                      ? 'Watercraft/air legs and routes without OSRM coverage use straight-line estimates.'
                      : 'Road vehicles follow OpenStreetMap streets; watercraft and air units stay straight-line.'}
              </p>
            </div>
          </div>

          {/* Top Right Floating Navigation Tools */}
          <div className="absolute top-3 right-3 z-20 flex flex-col gap-2">
            <div className={`${hudCardClass} rounded-xl flex flex-col p-1 gap-1`}>
              <button
                type="button"
                onClick={() => triggerAction('zoom-in')}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  isLight
                    ? 'hover:bg-slate-100 text-slate-700'
                    : 'hover:bg-slate-800 text-slate-200'
                }`}
                title="Zoom In"
              >
                <span className="material-symbols-outlined text-base">add</span>
              </button>
              <button
                type="button"
                onClick={() => triggerAction('zoom-out')}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  isLight
                    ? 'hover:bg-slate-100 text-slate-700'
                    : 'hover:bg-slate-800 text-slate-200'
                }`}
                title="Zoom Out"
              >
                <span className="material-symbols-outlined text-base">remove</span>
              </button>
              <div className={`h-px my-0.5 ${isLight ? 'bg-slate-200' : 'bg-slate-700'}`} />
              <button
                type="button"
                onClick={() => triggerAction('center-critical')}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  isLight ? 'hover:bg-slate-100 text-red-600' : 'hover:bg-slate-800 text-red-400'
                }`}
                title="Center on Critical Incident"
              >
                <span className="material-symbols-outlined text-base">center_focus_strong</span>
              </button>
              <button
                type="button"
                onClick={() => triggerAction('fit')}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  isLight ? 'hover:bg-slate-100 text-blue-600' : 'hover:bg-slate-800 text-teal-400'
                }`}
                title="Fit to All Visible Markers"
              >
                <span className="material-symbols-outlined text-base">crop_free</span>
              </button>
            </div>

            {/* Compass HUD */}
            <div
              className={`w-9 h-9 rounded-full ${hudCardClass} flex items-center justify-center self-center font-mono text-[11px] font-bold relative`}
            >
              <span className="text-[9px] text-red-500 absolute top-0.5 font-bold">N</span>
              <span
                className={`material-symbols-outlined text-xs rotate-45 ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                navigation
              </span>
            </div>
          </div>

          {/* Floating Map Legend (Bottom-Left) */}
          <div className="absolute bottom-6 left-3 z-20 hidden sm:block">
            <div className={`${hudCardClass} p-2.5 rounded-xl space-y-1.5 text-[11px]`}>
              <div
                className={`text-[10px] font-mono uppercase font-bold mb-1 ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                Map &amp; Route Key
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-1 rounded bg-[#1a73e8] inline-block" />
                <span>Road Route (OSRM)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-1.5 rounded-full bg-[#4285F4] ring-1 ring-white/80 inline-block shadow-sm" />
                <span className="font-medium text-blue-600 dark:text-blue-400">
                  Repair Route (Google Maps Road)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-0 border-t-2 border-dashed border-[#0f766e] inline-block" />
                <span>Straight-Line (Boat/Air/Fallback)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full bg-red-600 border border-red-300 animate-pulse" />
                <span>Critical Distress (DB: REAL / SIMULATED)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full bg-amber-600 border border-amber-300" />
                <span>High Urgency Incident (DB)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full bg-yellow-500 border border-yellow-200" />
                <span>Moderate / Low Incident (DB)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-teal-600 border border-teal-300 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[10px] text-white">
                    directions_boat
                  </span>
                </span>
                <span>Reference Fleet [SIMULATED]</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-emerald-700 border border-emerald-300 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[10px] text-white">
                    night_shelter
                  </span>
                </span>
                <span>Reference Shelter [SIMULATED • Unverified]</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded border border-dashed border-red-500 bg-red-500/20 inline-block" />
                <span>Reference Hazard Zone [SIMULATED]</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full bg-cyan-600 border border-cyan-300 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[10px] text-white">waves</span>
                </span>
                <span className="text-slate-200">River Discharge Station (Context)</span>
              </div>
            </div>
          </div>

          {/* REAL LEAFLET MAP WRAPPER */}
          <LeafletMapWrapper
            requests={requests}
            stagedFleet={combinedFleet}
            stagedShelters={combinedShelters}
            selectedAssignment={selectedAssignment}
            selectedRepairAssignment={selectedRepairAssignment}
            activeRepairRouteIndex={activeRepairRouteIndex}
            onSelectRepairRoute={setActiveRepairRouteIndex}
            blockedZones={STAGED_SECTOR_BLOCKED_ZONES}
            forecastContext={forecastContext}
            layers={effectiveLayers}
            urgencyFilter={urgencyFilter}
            selectedEntity={selectedEntity}
            onSelectEntity={setSelectedEntity}
            tileTheme={tileTheme}
            actionTrigger={actionTrigger}
            routeMode={routeMode}
            onSwitchRouteMode={setRouteMode}
            resourceTypeMap={resourceTypeMap}
          />
        </div>

        {/* ========================================================================= */}
        {/* 2. SELECTED ENTITY DETAIL INSPECTOR PANEL                                 */}
        {/* ========================================================================= */}
        <aside
          className={`w-full lg:w-96 bg-surface-container-lowest border-l border-outline-variant shadow-2xl z-20 flex flex-col justify-between overflow-y-auto transition-transform duration-300 ${
            selectedEntity
              ? 'translate-y-0 lg:translate-x-0'
              : 'translate-y-full lg:translate-x-full'
          } fixed lg:static bottom-0 right-0 max-h-[85vh] lg:max-h-full`}
        >
          <MapInspectorDrawer
            selectedEntity={selectedEntity}
            onClose={() => setSelectedEntity(null)}
            assignedRoute={activeRouteForIncident}
            assignedResourceName={assignedResourceName}
            assignedResourceType={assignedResourceType}
            routeMetrics={activeRouteMetrics}
            routeMode={routeMode}
            onPlanAssignment={handlePlanAssignment}
            isPlanningAssignment={isPlanningAssignment}
          />
        </aside>
      </div>
    </div>
  );
}

export default function OperatorMapPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 flex items-center justify-center text-blue-700 font-mono text-xs">
          Loading Operations GIS Canvas...
        </div>
      }
    >
      <OperatorMapContent />
    </Suspense>
  );
}
