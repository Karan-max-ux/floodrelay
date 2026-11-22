'use client';

import React from 'react';
import Link from 'next/link';
import type { ResourceRoute } from '@floodrelay/shared';
import type { SelectedMapEntity } from './LeafletMapCanvas';
import {
  type RouteDisplayMetrics,
  type RouteMode,
  formatDistanceKm,
  formatDurationMinutes,
} from './routeDisplay';
import { formatRegionDateTime } from '@/lib/region';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';

export interface MapInspectorDrawerProps {
  selectedEntity: SelectedMapEntity;
  onClose: () => void;
  assignedRoute?: ResourceRoute | null;
  assignedResourceName?: string | null;
  assignedResourceType?: string | null;
  routeMetrics?: RouteDisplayMetrics | null;
  routeMode?: RouteMode;
  onPlanAssignment?: () => Promise<void> | void;
  isPlanningAssignment?: boolean;
}

export function MapInspectorDrawer({
  selectedEntity,
  onClose,
  assignedRoute,
  assignedResourceName,
  assignedResourceType,
  routeMetrics,
  routeMode = 'ROAD',
  onPlanAssignment,
  isPlanningAssignment = false,
}: MapInspectorDrawerProps) {
  if (!selectedEntity) {
    return (
      <div className="p-8 text-center text-on-surface-variant text-xs space-y-2 my-auto">
        <span className="material-symbols-outlined text-4xl text-outline">location_searching</span>
        <p className="font-bold text-on-surface">Tactical Map Inspector</p>
        <p className="text-[11px]">
          Click any distress ticket, rescue craft, or shelter marker on the map to inspect full
          telemetry and caller records.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
        <div>
          <span className="font-mono text-[10px] uppercase font-bold text-primary block">
            {selectedEntity.type === 'incident'
              ? 'DISTRESS TICKET'
              : selectedEntity.type === 'craft'
                ? 'SECTOR CRAFT ASSET'
                : 'RELIEF FACILITY'}
          </span>
          <h3 className="font-mono text-base font-bold text-on-surface">
            {'id' in selectedEntity.item ? selectedEntity.item.id : 'Selected Asset'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          title="Close Inspector"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      {/* ------------------ INCIDENT DETAILS ------------------ */}
      {selectedEntity.type === 'incident' && (
        <div className="space-y-3.5">
          <div className="flex items-center gap-2">
            <UrgencyBadge urgency={selectedEntity.item.urgency} />
            <StatusBadge status={selectedEntity.item.status || 'PENDING'} />
            {selectedEntity.item.medicalNeeds && (
              <span className="px-2 py-0.5 rounded text-[10px] bg-red-100 text-red-900 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">medical_services</span>
                Medical Assistance Required
              </span>
            )}
          </div>

          {/* Assigned Mission Status & Route Telemetry */}
          {assignedRoute ? (
            <div className="p-3 rounded-lg bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-slate-800 dark:text-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  Active Route Assigned
                </span>
                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700">
                  {routeMode === 'DIRECT'
                    ? 'Direct / Air'
                    : routeMetrics?.source === 'OSRM'
                      ? 'OSRM Road Route'
                      : 'Straight-Line Vector'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <div className="p-2 rounded bg-white/80 dark:bg-slate-900/80 border border-blue-200/60 dark:border-blue-800/60">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                    Assigned Resource
                  </span>
                  <span
                    className="font-bold text-slate-900 dark:text-slate-100 text-xs block truncate"
                    title={assignedResourceName || assignedRoute.resourceId}
                  >
                    {assignedResourceName || assignedRoute.resourceId}
                  </span>
                  <span className="font-mono text-[9px] text-blue-600 dark:text-blue-400 block mt-0.5">
                    {assignedResourceType || 'HIGH_WATER_VEHICLE'}
                  </span>
                </div>

                <div className="p-2 rounded bg-white/80 dark:bg-slate-900/80 border border-blue-200/60 dark:border-blue-800/60">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                    Mission Transit
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 text-xs block">
                    {routeMetrics
                      ? `${formatDistanceKm(routeMetrics.distanceKm)} • ${formatDurationMinutes(routeMetrics.durationMinutes)}`
                      : 'Calculating...'}
                  </span>
                  <span className="font-mono text-[9px] text-slate-500 dark:text-slate-400 block mt-0.5">
                    {routeMetrics?.source === 'OSRM' ? 'Road Network' : 'Straight-Line Vector'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-base shrink-0 mt-0.5">
                info
              </span>
              <span className="text-[11px] leading-tight">
                No active route assignment serving this incident. Click{' '}
                <strong>Plan Assignment</strong> below to calculate rescue mission.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-surface border border-outline-variant/60">
              <span className="text-[10px] text-on-surface-variant block">
                Headcount Awaiting Rescue
              </span>
              <span className="font-bold text-on-surface text-base">
                {selectedEntity.item.peopleCount} Passengers
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-surface border border-outline-variant/60">
              <span className="text-[10px] text-on-surface-variant block">Intake Provenance</span>
              <span
                className={`inline-flex items-center font-mono font-bold text-[11px] px-1.5 py-0.5 rounded mt-0.5 ${
                  selectedEntity.item.source === 'SIMULATED'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                }`}
              >
                {selectedEntity.item.source === 'SIMULATED' ? 'SIMULATED' : 'REAL / REPORTED'}
              </span>
            </div>
          </div>

          <div>
            <span className="text-[10px] uppercase font-mono text-on-surface-variant font-bold block mb-1">
              Precise Geographic Coordinates
            </span>
            <div className="p-2 rounded-lg bg-surface font-mono text-on-surface border border-outline-variant/40 flex items-center justify-between">
              <span>
                {selectedEntity.item.lat.toFixed(6)}° N,{' '}
                {Math.abs(selectedEntity.item.lng).toFixed(6)}°{' '}
                {selectedEntity.item.lng >= 0 ? 'E' : 'W'}
              </span>
              <span className="material-symbols-outlined text-primary text-base">pin_drop</span>
            </div>
          </div>

          <div>
            <span className="text-[10px] uppercase font-mono text-on-surface-variant font-bold block mb-1">
              Caller Situation &amp; Notes
            </span>
            <p className="p-3 rounded-lg bg-surface border border-outline-variant/40 text-on-surface leading-relaxed">
              {selectedEntity.item.notes || 'No specific caller instructions logged.'}
            </p>
          </div>

          {selectedEntity.item.isFlaggedDuplicate && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-950">
              <div className="flex items-center gap-1.5 font-bold text-[11px] text-amber-800">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                <span>Potential Duplicate Report</span>
              </div>
              <p className="text-[11px] mt-1 text-amber-900">
                Proximity match with ticket #
                {selectedEntity.item.duplicateOfId || 'associated ticket'}.
              </p>
            </div>
          )}

          <div>
            <span className="text-[10px] uppercase font-mono text-on-surface-variant font-bold block mb-1">
              Logged Timestamp (IST)
            </span>
            <div className="p-2 rounded bg-surface font-mono text-on-surface text-[11px] border border-outline-variant/40">
              {selectedEntity.item.createdAt
                ? formatRegionDateTime(selectedEntity.item.createdAt)
                : 'Unknown'}
            </div>
          </div>
        </div>
      )}

      {/* ------------------ CRAFT DETAILS ------------------ */}
      {selectedEntity.type === 'craft' && (
        <div className="space-y-3.5">
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-950">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-xs text-amber-950 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">directions_boat</span>
                <span>{selectedEntity.item.name}</span>
              </div>
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 shrink-0">
                {selectedEntity.item.source || 'SIMULATED'}
              </span>
            </div>
            <div className="text-[11px] text-amber-900 mt-0.5">
              Simulated demonstration asset • Delhi–Yamuna Floodplain reference
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-surface border border-outline-variant/60">
              <span className="text-[10px] text-on-surface-variant block">Passenger Cap</span>
              <span className="font-bold text-on-surface text-base">
                {selectedEntity.item.capacity} Pax
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-surface border border-outline-variant/60">
              <span className="text-[10px] text-on-surface-variant block">Max Transit Speed</span>
              <span className="font-bold text-on-surface text-base">
                {selectedEntity.item.speedKmH} km/h
              </span>
            </div>
          </div>

          <div>
            <span className="text-[10px] uppercase font-mono text-on-surface-variant font-bold block mb-1">
              Staging Depot Location
            </span>
            <div className="p-2.5 rounded-lg bg-surface border border-outline-variant/40 text-on-surface">
              <div className="font-semibold">{selectedEntity.item.depotName}</div>
              <div className="font-mono text-[11px] text-on-surface-variant mt-0.5">
                {selectedEntity.item.lat.toFixed(4)}° N,{' '}
                {Math.abs(selectedEntity.item.lng).toFixed(4)}°{' '}
                {selectedEntity.item.lng >= 0 ? 'E' : 'W'}
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-surface-container border border-outline-variant text-[11px] text-on-surface-variant">
            <span className="font-bold block text-on-surface">Provenance Notice (SIMULATED):</span>
            <span>
              Synthetic reference fleet marker from the Delhi–Yamuna demonstration scenario. Not
              linked to live field transponders, official NDRF units, or authoritative PostgreSQL
              fleet inventory.
            </span>
          </div>
        </div>
      )}

      {/* ------------------ SHELTER DETAILS ------------------ */}
      {selectedEntity.type === 'shelter' && (
        <div className="space-y-3.5">
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-950">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-xs text-amber-950 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">night_shelter</span>
                <span>{selectedEntity.item.name}</span>
              </div>
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 shrink-0">
                {selectedEntity.item.source || 'SIMULATED'}
              </span>
            </div>
            <div className="text-[11px] text-amber-900 mt-0.5">{selectedEntity.item.status}</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-surface border border-outline-variant/60">
              <span className="text-[10px] text-on-surface-variant block">
                Simulated Capacity Headroom
              </span>
              <span className="font-bold text-on-surface text-base">
                {selectedEntity.item.availableBeds} Beds
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-surface border border-outline-variant/60">
              <span className="text-[10px] text-on-surface-variant block">
                Simulated Total Capacity
              </span>
              <span className="font-bold text-on-surface text-base">
                {selectedEntity.item.capacity} Beds
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-surface-container border border-outline-variant text-[11px] text-on-surface-variant">
            <span className="font-bold block text-on-surface">
              Unverified Reference Shelter (SIMULATED):
            </span>
            <span>
              This marker represents a synthetic planning reference. FloodRelay does not verify live
              shelter opening status, staffing, or real-time bed availability.
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-mono text-on-surface-variant font-bold block mb-1">
              Shelter Coordinates
            </span>
            <div className="p-2 rounded bg-surface font-mono text-on-surface text-[11px] border border-outline-variant/40">
              {selectedEntity.item.lat.toFixed(6)}° N,{' '}
              {Math.abs(selectedEntity.item.lng).toFixed(6)}°{' '}
              {selectedEntity.item.lng >= 0 ? 'E' : 'W'}
            </div>
          </div>
        </div>
      )}

      {/* Incident Assignment Navigation Action */}
      {selectedEntity.type === 'incident' && (
        <div className="pt-3 border-t border-outline-variant space-y-2">
          {onPlanAssignment ? (
            <button
              type="button"
              onClick={onPlanAssignment}
              disabled={isPlanningAssignment}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-teal-900 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">assignment</span>
              <span>{isPlanningAssignment ? 'Generating Mission Plan...' : 'Plan Assignment'}</span>
            </button>
          ) : null}

          <Link
            href="/operator/assignments"
            className={`w-full rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm ${
              onPlanAssignment
                ? 'py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                : 'py-2.5 px-4 bg-teal-700 hover:bg-teal-800 text-white'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">assignment</span>
            <span>Plan Assignment</span>
          </Link>
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            Plans are proposed on the Assignments page and must be reviewed and committed by an
            operator.
          </p>
        </div>
      )}
    </div>
  );
}
