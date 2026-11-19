/**
 * Deterministic Native Delhi–Yamuna Repair Proposal Fixtures for Phase 5 Part 3
 *
 * Used for frontend demonstration and visual verification while the
 * Phase 5 Part 2 incremental optimization solver is pending live integration.
 *
 * All coordinates, resources, shelters, and requests are natively authored
 * within the North Delhi / Yamuna Floodplain reference bounds (aligned with
 * scenarios/sample-scenario.json and mapReferenceData.ts).
 *
 * All records are explicitly SIMULATED and must NEVER be committed to the
 * operational PostgreSQL database.
 */

import type { SolverPlan, RouteStop, ResourceRoute, RescueRequest } from '@floodrelay/shared';
import type { RepairResult } from '@/lib/api/types';

/**
 * Explicitly defined synthetic Delhi–Yamuna rescue requests referenced by
 * SIMULATED_BASELINE_PLAN and SIMULATED_REPAIR_RESULT.
 * Requests req-001..req-005 match scenarios/sample-scenario.json exactly;
 * req-delhi-repair-006 and req-delhi-repair-007 extend the repair evaluation
 * scenario within the same North Delhi / Yamuna Floodplain corridor.
 */
export const DELHI_REPAIR_SCENARIO_REQUESTS: RescueRequest[] = [
  {
    id: 'req-001',
    lat: 28.665,
    lng: 77.228,
    peopleCount: 4,
    urgency: 'HIGH',
    createdAt: '2026-10-15T12:02:00.000Z',
    source: 'SIMULATED',
    notes: 'Elderly couple and 2 children stranded on terrace (Yamuna Bazar, simulated).',
  },
  {
    id: 'req-002',
    lat: 28.671,
    lng: 77.234,
    peopleCount: 6,
    urgency: 'CRITICAL',
    createdAt: '2026-10-15T12:05:00.000Z',
    source: 'SIMULATED',
    medicalNeeds: true,
    notes:
      'Rising water near Civil Lines / Monastery Market, medical attention needed (simulated).',
  },
  {
    id: 'req-003',
    lat: 28.682,
    lng: 77.24,
    peopleCount: 2,
    urgency: 'MEDIUM',
    createdAt: '2026-10-15T12:10:00.000Z',
    source: 'SIMULATED',
    notes: 'Two residents stranded near Majnu Ka Tilla embankment (simulated).',
  },
  {
    id: 'req-004',
    lat: 28.69,
    lng: 77.225,
    peopleCount: 5,
    urgency: 'HIGH',
    createdAt: '2026-10-15T12:12:00.000Z',
    source: 'SIMULATED',
    notes: 'Five occupants awaiting evacuation near Timarpur / Wazirabad Road (simulated).',
  },
  {
    id: 'req-005',
    lat: 28.678,
    lng: 77.218,
    peopleCount: 3,
    urgency: 'LOW',
    createdAt: '2026-10-15T12:15:00.000Z',
    source: 'SIMULATED',
    notes: 'Precautionary evacuation request in North Civil Lines (simulated).',
  },
  {
    id: 'req-delhi-repair-006',
    lat: 28.698,
    lng: 77.238,
    peopleCount: 4,
    urgency: 'MEDIUM',
    createdAt: '2026-10-15T12:18:00.000Z',
    source: 'SIMULATED',
    notes: 'Burari floodplain embankment cluster awaiting shallow-draft craft (simulated).',
  },
  {
    id: 'req-delhi-repair-007',
    lat: 28.659,
    lng: 77.246,
    peopleCount: 2,
    urgency: 'CRITICAL',
    createdAt: '2026-10-15T12:20:00.000Z',
    source: 'SIMULATED',
    medicalNeeds: true,
    notes: 'Stranded near Old Railway Bridge east approach road (simulated).',
  },
];

export const SIMULATED_BASELINE_PLAN: SolverPlan = {
  scenarioId: 'delhi-yamuna-north-baseline',
  calculatedAt: new Date(Date.now() - 3600000).toISOString(),
  solverStatus: 'COMMITTED',
  routes: [
    {
      resourceId: 'res-boat-01',
      totalTravelDistanceKm: 4.5,
      totalDurationMinutes: 18,
      servedRequestIds: ['req-001', 'req-005'],
      stops: [
        {
          stopNumber: 1,
          type: 'PICKUP',
          targetId: 'req-001',
          lat: 28.665,
          lng: 77.228,
          passengersPickedUp: 4,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 5,
          isFrozen: true, // Already committed / en-route stop
        },
        {
          stopNumber: 2,
          type: 'PICKUP',
          targetId: 'req-005',
          lat: 28.678,
          lng: 77.218,
          passengersPickedUp: 3,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 12,
          isFrozen: false,
        },
        {
          stopNumber: 3,
          type: 'DROPOFF',
          targetId: 'shelter-kashmere-gate',
          lat: 28.668,
          lng: 77.232,
          passengersPickedUp: 0,
          passengersDroppedOff: 7,
          estimatedArrivalMinutes: 18,
          isFrozen: false,
        },
      ],
    },
    {
      resourceId: 'res-truck-01',
      totalTravelDistanceKm: 13.2,
      totalDurationMinutes: 34,
      servedRequestIds: ['req-002', 'req-004', 'req-003'],
      stops: [
        {
          stopNumber: 1,
          type: 'PICKUP',
          targetId: 'req-002',
          lat: 28.671,
          lng: 77.234,
          passengersPickedUp: 6,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 10,
          isFrozen: true, // Already committed stop
        },
        {
          stopNumber: 2,
          type: 'PICKUP',
          targetId: 'req-004',
          lat: 28.69,
          lng: 77.225,
          passengersPickedUp: 5,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 19,
          isFrozen: false,
        },
        {
          stopNumber: 3,
          type: 'PICKUP',
          targetId: 'req-003',
          lat: 28.682,
          lng: 77.24,
          passengersPickedUp: 2,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 26,
          isFrozen: false,
        },
        {
          stopNumber: 4,
          type: 'DROPOFF',
          targetId: 'shelter-wazirabad',
          lat: 28.705,
          lng: 77.228,
          passengersPickedUp: 0,
          passengersDroppedOff: 13,
          estimatedArrivalMinutes: 34,
          isFrozen: false,
        },
      ],
    },
  ],
  unserved: [
    {
      requestId: 'req-delhi-repair-006',
      reason: 'CAPACITY_EXCEEDED',
      details:
        'No available craft with remaining capacity for Burari floodplain embankment cluster',
    },
    {
      requestId: 'req-delhi-repair-007',
      reason: 'NO_REACHABLE_RESOURCE',
      details:
        'Road approach blocked by simulated hazard zone zone-old-railway-bridge (Old Railway Bridge)',
    },
  ],
  metrics: {
    coveragePercent: 71.4,
    totalTravelTimeMinutes: 52,
    totalTravelDistanceKm: 17.7,
    highPriorityWaitTimeMinutes: 19,
    solveDurationMs: 310,
    servedRequestsCount: 5,
    unservedRequestsCount: 2,
  },
};

export const SIMULATED_REPAIR_RESULT: RepairResult = {
  status: 'PROPOSED',
  baselineVersion: 1,
  warnings: [
    'Stop #1 on Simulated Rescue Boat Alpha (req-001) is FROZEN and preserved in place.',
    'Stop #1 on Simulated High-Clearance Truck 1 (req-002) is FROZEN and preserved in place.',
    'Simulated hazard zone zone-old-railway-bridge (Old Railway Bridge) bypassed by activating res-boat-02 for req-delhi-repair-007.',
    'Reassigned req-003 and req-005 between res-boat-01 and res-truck-01 to reduce Ring Road corridor detour.',
  ],
  unservedRequestIds: ['req-delhi-repair-006'],
  proposedPlan: {
    scenarioId: 'delhi-yamuna-north-repaired',
    calculatedAt: new Date().toISOString(),
    solverStatus: 'PROPOSED',
    routes: [
      {
        resourceId: 'res-boat-01',
        totalTravelDistanceKm: 4.9,
        totalDurationMinutes: 19,
        servedRequestIds: ['req-001', 'req-003'],
        stops: [
          {
            stopNumber: 1,
            type: 'PICKUP',
            targetId: 'req-001',
            lat: 28.665,
            lng: 77.228,
            passengersPickedUp: 4,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 5,
            isFrozen: true, // Preserved
          },
          {
            stopNumber: 2,
            type: 'PICKUP',
            targetId: 'req-003', // Reassigned from res-truck-01
            lat: 28.682,
            lng: 77.24,
            passengersPickedUp: 2,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 13,
            isFrozen: false,
          },
          {
            stopNumber: 3,
            type: 'DROPOFF',
            targetId: 'shelter-kashmere-gate',
            lat: 28.668,
            lng: 77.232,
            passengersPickedUp: 0,
            passengersDroppedOff: 6,
            estimatedArrivalMinutes: 19,
            isFrozen: false,
          },
        ],
      },
      {
        resourceId: 'res-truck-01',
        totalTravelDistanceKm: 10.7,
        totalDurationMinutes: 29,
        servedRequestIds: ['req-002', 'req-005', 'req-004'],
        stops: [
          {
            stopNumber: 1,
            type: 'PICKUP',
            targetId: 'req-002',
            lat: 28.671,
            lng: 77.234,
            passengersPickedUp: 6,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 10,
            isFrozen: true, // Preserved
          },
          {
            stopNumber: 2,
            type: 'PICKUP',
            targetId: 'req-005', // Reassigned from res-boat-01
            lat: 28.678,
            lng: 77.218,
            passengersPickedUp: 3,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 16,
            isFrozen: false,
          },
          {
            stopNumber: 3,
            type: 'PICKUP',
            targetId: 'req-004', // Reordered from Stop #2 -> #3
            lat: 28.69,
            lng: 77.225,
            passengersPickedUp: 5,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 22,
            isFrozen: false,
          },
          {
            stopNumber: 4,
            type: 'DROPOFF',
            targetId: 'shelter-wazirabad',
            lat: 28.705,
            lng: 77.228,
            passengersPickedUp: 0,
            passengersDroppedOff: 14,
            estimatedArrivalMinutes: 29,
            isFrozen: false,
          },
        ],
      },
      {
        resourceId: 'res-boat-02', // Newly activated watercraft resource
        totalTravelDistanceKm: 4.5,
        totalDurationMinutes: 16,
        servedRequestIds: ['req-delhi-repair-007'],
        stops: [
          {
            stopNumber: 1,
            type: 'PICKUP',
            targetId: 'req-delhi-repair-007', // Previously unserved, bypassed road hazard via water channel
            lat: 28.659,
            lng: 77.246,
            passengersPickedUp: 2,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 9,
            isFrozen: false,
          },
          {
            stopNumber: 2,
            type: 'DROPOFF',
            targetId: 'shelter-kashmere-gate',
            lat: 28.668,
            lng: 77.232,
            passengersPickedUp: 0,
            passengersDroppedOff: 2,
            estimatedArrivalMinutes: 16,
            isFrozen: false,
          },
        ],
      },
    ],
    unserved: [
      {
        requestId: 'req-delhi-repair-006',
        reason: 'CAPACITY_EXCEEDED',
        details: 'Simulated shallow-water access constraint near Burari embankment; awaiting craft',
      },
    ],
    metrics: {
      coveragePercent: 85.7,
      totalTravelTimeMinutes: 64,
      totalTravelDistanceKm: 20.1,
      highPriorityWaitTimeMinutes: 14,
      solveDurationMs: 280,
      servedRequestsCount: 6,
      unservedRequestsCount: 1,
    },
  },
};

export type StopDiffStatus =
  'UNCHANGED' | 'FROZEN' | 'ADDED' | 'REMOVED' | 'REASSIGNED' | 'REORDERED';

export interface StopDiffItem {
  targetId: string;
  type: string;
  status: StopDiffStatus;
  baselineResourceId?: string;
  repairedResourceId?: string;
  baselineStopNumber?: number;
  repairedStopNumber?: number;
  isFrozen: boolean;
  passengers: number;
  notes?: string;
}

export interface RepairDiffAnalysis {
  stopDiffs: StopDiffItem[];
  churnPercent: number;
  movedRequestsCount: number;
  addedStopsCount: number;
  removedStopsCount: number;
  reassignedStopsCount: number;
  reorderedStopsCount: number;
  frozenStopsCount: number;
  unchangedStopsCount: number;
  unservedDelta: number;
  travelTimeDeltaMinutes: number;
  coverageDeltaPercent: number;
  highPriorityWaitDeltaMinutes: number;
}

/**
 * Computes a deterministic diff analysis comparing a baseline plan with a repaired plan.
 */
export function computeRepairDiff(baseline: SolverPlan, repaired: SolverPlan): RepairDiffAnalysis {
  const baselineStopsMap = new Map<string, { route: ResourceRoute; stop: RouteStop }>();
  for (const route of baseline.routes) {
    for (const stop of route.stops) {
      baselineStopsMap.set(`${stop.targetId}:${stop.type}`, { route, stop });
    }
  }

  const repairedStopsMap = new Map<string, { route: ResourceRoute; stop: RouteStop }>();
  for (const route of repaired.routes) {
    for (const stop of route.stops) {
      repairedStopsMap.set(`${stop.targetId}:${stop.type}`, { route, stop });
    }
  }

  const allKeys = new Set([
    ...Array.from(baselineStopsMap.keys()),
    ...Array.from(repairedStopsMap.keys()),
  ]);

  const stopDiffs: StopDiffItem[] = [];
  let movedRequestsCount = 0;
  let addedStopsCount = 0;
  let removedStopsCount = 0;
  let reassignedStopsCount = 0;
  let reorderedStopsCount = 0;
  let frozenStopsCount = 0;
  let unchangedStopsCount = 0;

  for (const key of Array.from(allKeys)) {
    const base = baselineStopsMap.get(key);
    const rep = repairedStopsMap.get(key);

    if (base && !rep) {
      removedStopsCount++;
      movedRequestsCount++;
      stopDiffs.push({
        targetId: base.stop.targetId,
        type: base.stop.type,
        status: 'REMOVED',
        baselineResourceId: base.route.resourceId,
        baselineStopNumber: base.stop.stopNumber,
        isFrozen: false,
        passengers: base.stop.passengersPickedUp || base.stop.passengersDroppedOff,
        notes: `Removed from ${base.route.resourceId}`,
      });
    } else if (!base && rep) {
      addedStopsCount++;
      movedRequestsCount++;
      stopDiffs.push({
        targetId: rep.stop.targetId,
        type: rep.stop.type,
        status: 'ADDED',
        repairedResourceId: rep.route.resourceId,
        repairedStopNumber: rep.stop.stopNumber,
        isFrozen: rep.stop.isFrozen || false,
        passengers: rep.stop.passengersPickedUp || rep.stop.passengersDroppedOff,
        notes: `Added to ${rep.route.resourceId}`,
      });
    } else if (base && rep) {
      const isFrozen = rep.stop.isFrozen || base.stop.isFrozen || false;
      const sameResource = base.route.resourceId === rep.route.resourceId;
      const sameOrder = base.stop.stopNumber === rep.stop.stopNumber;

      if (isFrozen) {
        frozenStopsCount++;
        stopDiffs.push({
          targetId: rep.stop.targetId,
          type: rep.stop.type,
          status: 'FROZEN',
          baselineResourceId: base.route.resourceId,
          repairedResourceId: rep.route.resourceId,
          baselineStopNumber: base.stop.stopNumber,
          repairedStopNumber: rep.stop.stopNumber,
          isFrozen: true,
          passengers: rep.stop.passengersPickedUp || rep.stop.passengersDroppedOff,
          notes: 'Frozen stop preserved in position',
        });
      } else if (!sameResource) {
        reassignedStopsCount++;
        movedRequestsCount++;
        stopDiffs.push({
          targetId: rep.stop.targetId,
          type: rep.stop.type,
          status: 'REASSIGNED',
          baselineResourceId: base.route.resourceId,
          repairedResourceId: rep.route.resourceId,
          baselineStopNumber: base.stop.stopNumber,
          repairedStopNumber: rep.stop.stopNumber,
          isFrozen: false,
          passengers: rep.stop.passengersPickedUp || rep.stop.passengersDroppedOff,
          notes: `Reassigned: ${base.route.resourceId} → ${rep.route.resourceId}`,
        });
      } else if (!sameOrder) {
        reorderedStopsCount++;
        movedRequestsCount++;
        stopDiffs.push({
          targetId: rep.stop.targetId,
          type: rep.stop.type,
          status: 'REORDERED',
          baselineResourceId: base.route.resourceId,
          repairedResourceId: rep.route.resourceId,
          baselineStopNumber: base.stop.stopNumber,
          repairedStopNumber: rep.stop.stopNumber,
          isFrozen: false,
          passengers: rep.stop.passengersPickedUp || rep.stop.passengersDroppedOff,
          notes: `Sequence shifted: Stop #${base.stop.stopNumber} → #${rep.stop.stopNumber}`,
        });
      } else {
        unchangedStopsCount++;
        stopDiffs.push({
          targetId: rep.stop.targetId,
          type: rep.stop.type,
          status: 'UNCHANGED',
          baselineResourceId: base.route.resourceId,
          repairedResourceId: rep.route.resourceId,
          baselineStopNumber: base.stop.stopNumber,
          repairedStopNumber: rep.stop.stopNumber,
          isFrozen: false,
          passengers: rep.stop.passengersPickedUp || rep.stop.passengersDroppedOff,
        });
      }
    }
  }

  const totalBaselineStops = baselineStopsMap.size || 1;
  const churnPercent = Math.min(100, Math.round((movedRequestsCount / totalBaselineStops) * 100));

  const baselineUnservedCount = baseline.unserved?.length ?? 0;
  const repairedUnservedCount = repaired.unserved?.length ?? 0;
  const unservedDelta = repairedUnservedCount - baselineUnservedCount;

  const baselineTravelTime = baseline.metrics?.totalTravelTimeMinutes ?? 0;
  const repairedTravelTime = repaired.metrics?.totalTravelTimeMinutes ?? 0;
  const travelTimeDeltaMinutes = repairedTravelTime - baselineTravelTime;

  const baselineCoverage = baseline.metrics?.coveragePercent ?? 0;
  const repairedCoverage = repaired.metrics?.coveragePercent ?? 0;
  const coverageDeltaPercent = Number((repairedCoverage - baselineCoverage).toFixed(1));

  const baselineWait = baseline.metrics?.highPriorityWaitTimeMinutes ?? 0;
  const repairedWait = repaired.metrics?.highPriorityWaitTimeMinutes ?? 0;
  const highPriorityWaitDeltaMinutes = repairedWait - baselineWait;

  return {
    stopDiffs,
    churnPercent,
    movedRequestsCount,
    addedStopsCount,
    removedStopsCount,
    reassignedStopsCount,
    reorderedStopsCount,
    frozenStopsCount,
    unchangedStopsCount,
    unservedDelta,
    travelTimeDeltaMinutes,
    coverageDeltaPercent,
    highPriorityWaitDeltaMinutes,
  };
}
