import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateScenario, type Scenario } from '@floodrelay/shared';
import CitizenRequestPage from '../app/citizen/request/page';
import { RoadBlockageModal } from '../components/operator/RoadBlockageModal';
import { MapInspectorDrawer } from '../components/operator/map/MapInspectorDrawer';
import { OperationalEventCard } from '../components/operator/OperationalEventCard';
import {
  SIMULATED_BASELINE_PLAN,
  SIMULATED_REPAIR_RESULT,
  DELHI_REPAIR_SCENARIO_REQUESTS,
} from '../lib/fixtures/repairFixtures';
import {
  STAGED_SECTOR_FLEET,
  STAGED_SECTOR_SHELTERS,
  STAGED_SECTOR_BLOCKED_ZONES,
  TACTICAL_MAP_DEFAULT_CENTRE,
} from '../lib/fixtures/mapReferenceData';
import { REGION_CONFIG } from '../lib/region';
import { haversineDistanceKm } from '../lib/geocoding';
import { extractRouteLatLngs } from '../components/operator/map/routeDisplay';
import {
  DEFAULT_LOCALE,
  LOCALE_CATALOGUE,
  getCitizenMessages,
  isLocaleEnabled,
  resolveActiveLocale,
} from '../lib/i18n';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/citizen/request',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock OperatorAuthContext
vi.mock('@/lib/auth/OperatorAuthContext', () => ({
  useOperatorAuth: () => ({
    operator: {
      id: 'op-delhi-01',
      name: 'Rohan Sharma',
      username: 'delhi_eoc_operator',
      role: 'DISPATCHER',
    },
    token: 'test-token',
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

const DELHI_NCR_BOUNDS = {
  minLat: 28.4,
  maxLat: 28.9,
  minLng: 76.8,
  maxLng: 77.6,
};

function isInDelhiBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= DELHI_NCR_BOUNDS.minLat &&
    lat <= DELHI_NCR_BOUNDS.maxLat &&
    lng >= DELHI_NCR_BOUNDS.minLng &&
    lng <= DELHI_NCR_BOUNDS.maxLng
  );
}

describe('PR #43 — Delhi NCR Complete Localisation, Native GIS Fixtures & Map Consistency', () => {
  describe('Phase 1: Active UI Delhi Placeholders, Indian English & IST Formatting', () => {
    it('Citizen request form uses Delhi coordinate placeholders and Indian English without Houston/US placeholders', () => {
      const html = renderToString(React.createElement(CitizenRequestPage));
      expect(html).toContain('placeholder="e.g. 28.6710"');
      expect(html).toContain('placeholder="e.g. 77.2340"');
      expect(html).not.toContain('placeholder="e.g. 29.7604"');
      expect(html).not.toContain('placeholder="e.g. -95.3698"');
      expect(html).not.toContain('chimney');
      expect(html).toContain('colour');
      expect(html).toContain('Delhi NCR');
      expect(html).toContain('call 112');
    });

    it('RoadBlockageModal uses Delhi road/coordinate placeholders instead of Buffalo Bayou / Houston', () => {
      const html = renderToString(
        React.createElement(RoadBlockageModal, {
          isOpen: true,
          onClose: () => {},
        }),
      );
      expect(html).not.toContain('Buffalo Bayou');
      expect(html).not.toContain('29.7604');
      expect(html).not.toContain('-95.3698');
      expect(html).toContain('Old Railway Bridge');
      expect(html).toContain('28.6620');
      expect(html).toContain('77.2420');
    });

    it('MapInspectorDrawer formats incident timestamps in IST and surfaces explicit provenance badges', () => {
      const incidentHtml = renderToString(
        React.createElement(MapInspectorDrawer, {
          selectedEntity: {
            type: 'incident',
            item: {
              id: 'req-delhi-real-01',
              lat: 28.668,
              lng: 77.232,
              peopleCount: 3,
              urgency: 'CRITICAL',
              createdAt: '2026-11-15T06:00:00.000Z',
              source: 'REPORTED',
              status: 'PENDING',
            },
          },
          onClose: () => {},
        }),
      );
      expect(incidentHtml).toContain('IST');
      expect(incidentHtml).toContain('15 Nov 2026');
      expect(incidentHtml).toContain('REAL');

      const shelterHtml = renderToString(
        React.createElement(MapInspectorDrawer, {
          selectedEntity: {
            type: 'shelter',
            item: STAGED_SECTOR_SHELTERS[0]!,
          },
          onClose: () => {},
        }),
      );
      expect(shelterHtml).toContain('SIMULATED');
      expect(shelterHtml).not.toContain('Open —');
      expect(shelterHtml).toContain('Unverified');

      const craftHtml = renderToString(
        React.createElement(MapInspectorDrawer, {
          selectedEntity: {
            type: 'craft',
            item: STAGED_SECTOR_FLEET[0]!,
          },
          onClose: () => {},
        }),
      );
      expect(craftHtml).toContain('SIMULATED');
      expect(craftHtml).not.toContain('Real-time GPS vessel transponders connect');
    });

    it('OperationalEventCard formats recordedAt timestamps in IST', () => {
      const html = renderToString(
        React.createElement(OperationalEventCard, {
          event: {
            id: 'evt-delhi-01',
            type: 'ROAD_BLOCKED',
            entityType: 'ROAD_ZONE',
            entityId: 'zone-old-railway-bridge',
            actorId: 'op-delhi-01',
            actorType: 'OPERATOR',
            occurredAt: '2026-11-15T06:00:00.000Z',
            recordedAt: '2026-11-15T06:00:00.000Z',
            payload: { name: 'Old Railway Bridge Approach' },
          },
        }),
      );
      expect(html).toContain('IST');
      expect(html).toContain('15 Nov 2026');
    });
  });

  describe('Phase 2: Native Delhi Repair Fixtures & Elimination of Houston Rebasing', () => {
    it('SIMULATED_BASELINE_PLAN and SIMULATED_REPAIR_RESULT use native Delhi NCR coordinates and entities', () => {
      expect(SIMULATED_BASELINE_PLAN.scenarioId).toContain('delhi');
      expect(SIMULATED_BASELINE_PLAN.scenarioId).not.toContain('harris');

      const repaired = SIMULATED_REPAIR_RESULT.proposedPlan;
      expect(repaired).toBeDefined();
      expect(repaired!.scenarioId).toContain('delhi');
      expect(repaired!.scenarioId).not.toContain('harris');

      // Validate every stop coordinate, entity resolution, pickup/dropoff order, and capacity
      const resourceMap = new Map(STAGED_SECTOR_FLEET.map((r) => [r.id, r]));
      const shelterMap = new Map(STAGED_SECTOR_SHELTERS.map((s) => [s.id, s]));
      const requestMap = new Map(DELHI_REPAIR_SCENARIO_REQUESTS.map((q) => [q.id, q]));

      for (const plan of [SIMULATED_BASELINE_PLAN, repaired!]) {
        const shelterIncoming = new Map<string, number>();

        for (const route of plan.routes) {
          const resource = resourceMap.get(route.resourceId);
          expect(
            resource,
            `Resource ${route.resourceId} must resolve to staged fleet`,
          ).toBeDefined();
          expect(resource!.source).toBe('SIMULATED');
          expect(route.totalTravelDistanceKm).toBeGreaterThan(0);
          expect(route.totalDurationMinutes).toBeGreaterThan(0);

          let onboard = 0;
          let seenDropoff = false;

          route.stops.forEach((stop, idx) => {
            expect(stop.stopNumber).toBe(idx + 1);
            expect(isInDelhiBounds(stop.lat, stop.lng)).toBe(true);

            if (stop.type === 'PICKUP') {
              expect(seenDropoff).toBe(false);
              const req = requestMap.get(stop.targetId);
              expect(req, `Pickup target ${stop.targetId} must resolve to request`).toBeDefined();
              expect(req!.source).toBe('SIMULATED');
              expect(stop.lat).toBeCloseTo(req!.lat, 5);
              expect(stop.lng).toBeCloseTo(req!.lng, 5);
              expect(stop.passengersPickedUp).toBe(req!.peopleCount);
              onboard += stop.passengersPickedUp;
              expect(onboard).toBeLessThanOrEqual(resource!.capacity);
            } else if (stop.type === 'DROPOFF') {
              seenDropoff = true;
              const shelter = shelterMap.get(stop.targetId);
              expect(
                shelter,
                `Dropoff target ${stop.targetId} must resolve to shelter`,
              ).toBeDefined();
              expect(shelter!.source).toBe('SIMULATED');
              expect(stop.lat).toBeCloseTo(shelter!.lat, 5);
              expect(stop.lng).toBeCloseTo(shelter!.lng, 5);
              expect(stop.passengersDroppedOff).toBe(onboard);
              shelterIncoming.set(
                shelter!.id,
                (shelterIncoming.get(shelter!.id) ?? 0) + stop.passengersDroppedOff,
              );
              onboard -= stop.passengersDroppedOff;
            }
          });

          expect(onboard).toBe(0);
        }

        // Verify simulated shelter capacity headroom
        for (const [shelterId, incoming] of shelterIncoming.entries()) {
          const shelter = shelterMap.get(shelterId)!;
          expect(incoming).toBeLessThanOrEqual(shelter.availableBeds);
          expect(shelter.availableBeds).toBeLessThanOrEqual(shelter.capacity);
        }

        // Unserved request IDs must resolve
        for (const u of plan.unserved) {
          const req = requestMap.get(u.requestId);
          expect(req, `Unserved request ${u.requestId} must resolve`).toBeDefined();
        }
      }

      // Warnings must not reference Houston locations
      const joinedWarnings = SIMULATED_REPAIR_RESULT.warnings.join(' ');
      expect(joinedWarnings).not.toMatch(/Heights Blvd|Harris|Houston|Westchase|NRG/i);
    });

    it('mapReferenceData.ts and operator/map/page.tsx contain no Houston anchor or runtime rebaseLatLng', () => {
      const refDataPath = path.resolve(__dirname, '../lib/fixtures/mapReferenceData.ts');
      const mapPagePath = path.resolve(__dirname, '../app/operator/map/page.tsx');
      const refSource = fs.readFileSync(refDataPath, 'utf8');
      const mapSource = fs.readFileSync(mapPagePath, 'utf8');

      expect(refSource).not.toContain('HOUSTON_ANCHOR');
      expect(refSource).not.toContain('rebaseLatLng');
      expect(refSource).not.toContain('29.7604');
      expect(refSource).not.toContain('-95.3698');

      expect(mapSource).not.toContain('rebaseLatLng');
      expect(mapSource).not.toContain('HOUSTON_ANCHOR');
    });
  });

  describe('Phase 3: Sample Scenario Metadata, Bounds & Reference Asset Integrity', () => {
    it('scenarios/sample-scenario.json passes validateScenario and matches all entity counts and bounds', () => {
      const scenarioPath = path.resolve(__dirname, '../../../scenarios/sample-scenario.json');
      const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8')) as Scenario;

      const validation = validateScenario(scenario);
      expect(validation.valid, `Errors: ${validation.errors.join('; ')}`).toBe(true);
      expect(scenario.simulated).toBe(true);
      expect(scenario.metadata.simulated).toBe(true);

      // Metadata description count must match actual request/resource/shelter counts
      expect(scenario.metadata.description).toContain(
        `${scenario.requests.length} rescue requests`,
      );
      expect(scenario.metadata.description).not.toContain('10 rescue requests');
      expect(scenario.metadata.description).toContain(
        `${scenario.resources.length} simulated resources`,
      );
      expect(scenario.metadata.description).toContain(
        `${scenario.shelters.length} simulated relief camps`,
      );

      // Every request, resource, and shelter is explicitly SIMULATED and within declared bounds
      const { bounds } = scenario.metadata;
      const shelterIds = new Set(scenario.shelters.map((s) => s.id));

      for (const req of scenario.requests) {
        expect(req.source).toBe('SIMULATED');
        expect(req.lat).toBeGreaterThanOrEqual(bounds.minLat);
        expect(req.lat).toBeLessThanOrEqual(bounds.maxLat);
        expect(req.lng).toBeGreaterThanOrEqual(bounds.minLng);
        expect(req.lng).toBeLessThanOrEqual(bounds.maxLng);
      }

      for (const res of scenario.resources) {
        expect(res.source).toBe('SIMULATED');
        expect(res.name).not.toMatch(/^NDRF\b/);
        expect(res.lat).toBeGreaterThanOrEqual(bounds.minLat);
        expect(res.lat).toBeLessThanOrEqual(bounds.maxLat);
        expect(res.lng).toBeGreaterThanOrEqual(bounds.minLng);
        expect(res.lng).toBeLessThanOrEqual(bounds.maxLng);
        if (res.depotId) {
          expect(shelterIds.has(res.depotId)).toBe(true);
        }
      }

      for (const sh of scenario.shelters) {
        expect(sh.source).toBe('SIMULATED');
        expect(sh.currentOccupancy ?? 0).toBeLessThanOrEqual(sh.capacity);
        expect(sh.lat).toBeGreaterThanOrEqual(bounds.minLat);
        expect(sh.lat).toBeLessThanOrEqual(bounds.maxLat);
        expect(sh.lng).toBeGreaterThanOrEqual(bounds.minLng);
        expect(sh.lng).toBeLessThanOrEqual(bounds.maxLng);
      }

      for (const zone of scenario.blockedZones ?? []) {
        expect(zone.polygon.length).toBeGreaterThanOrEqual(3);
        for (const pt of zone.polygon) {
          expect(pt.lat).toBeGreaterThanOrEqual(bounds.minLat);
          expect(pt.lat).toBeLessThanOrEqual(bounds.maxLat);
          expect(pt.lng).toBeGreaterThanOrEqual(bounds.minLng);
          expect(pt.lng).toBeLessThanOrEqual(bounds.maxLng);
        }
      }
    });

    it('staged reference shelters never claim live Open operational status', () => {
      for (const shelter of STAGED_SECTOR_SHELTERS) {
        expect(shelter.source).toBe('SIMULATED');
        expect(shelter.status).not.toMatch(/^Open\b/i);
        expect(shelter.status).toMatch(/Simulated|Reference/i);
        expect(shelter.availableBeds).toBeLessThanOrEqual(shelter.capacity);
      }

      for (const asset of STAGED_SECTOR_FLEET) {
        expect(asset.source).toBe('SIMULATED');
        expect(asset.name).not.toMatch(/^NDRF\b/);
      }

      for (const zone of STAGED_SECTOR_BLOCKED_ZONES) {
        expect(zone.source).toBe('SIMULATED');
        expect(zone.name).toMatch(/Simulated|Reference/i);
      }
    });
  });

  describe('Phase 4: Consistent Tactical Map Centre Configuration & Route Coherence', () => {
    it('derives TACTICAL_MAP_DEFAULT_CENTRE from centralised REGION_CONFIG', () => {
      expect(TACTICAL_MAP_DEFAULT_CENTRE).toEqual([
        REGION_CONFIG.tacticalDemoCentre.lat,
        REGION_CONFIG.tacticalDemoCentre.lng,
      ]);
      expect(isInDelhiBounds(TACTICAL_MAP_DEFAULT_CENTRE[0], TACTICAL_MAP_DEFAULT_CENTRE[1])).toBe(
        true,
      );
    });

    it('keeps native Delhi repair fixture travel distances and durations coherent with Haversine geometry', () => {
      const fleetMap = new Map(STAGED_SECTOR_FLEET.map((r) => [r.id, r]));
      const plans = [SIMULATED_BASELINE_PLAN, SIMULATED_REPAIR_RESULT.proposedPlan!];

      for (const plan of plans) {
        for (const route of plan.routes) {
          const asset = fleetMap.get(route.resourceId)!;
          let prevLat = asset.lat;
          let prevLng = asset.lng;
          let straightSumKm = 0;

          for (const stop of route.stops) {
            straightSumKm += haversineDistanceKm(prevLat, prevLng, stop.lat, stop.lng);
            prevLat = stop.lat;
            prevLng = stop.lng;
          }

          // Declared route distance must be at least straight-line lower bound (allowing rounding)
          expect(route.totalTravelDistanceKm).toBeGreaterThanOrEqual(straightSumKm * 0.9);
          // Declared duration must be >= pure transit time at vehicle top speed
          const minTransitMinutes = (route.totalTravelDistanceKm / asset.speedKmH) * 60;
          expect(route.totalDurationMinutes).toBeGreaterThanOrEqual(minTransitMinutes * 0.9);
        }
      }
    });

    it('preserves backend-supplied route coordinates verbatim without rebasing (including non-Delhi coords)', () => {
      const backendRoute = {
        resourceId: 'boat-assam-real-01',
        totalTravelDistanceKm: 5.4,
        totalDurationMinutes: 18,
        servedRequestIds: ['req-assam-01'],
        stops: [
          {
            stopNumber: 1,
            type: 'PICKUP' as const,
            targetId: 'req-assam-01',
            lat: 26.1445,
            lng: 91.7362,
            passengersPickedUp: 3,
            passengersDroppedOff: 0,
            estimatedArrivalMinutes: 8,
          },
          {
            stopNumber: 2,
            type: 'DROPOFF' as const,
            targetId: 'shelter-guwahati-01',
            lat: 26.1833,
            lng: 91.7458,
            passengersPickedUp: 0,
            passengersDroppedOff: 3,
            estimatedArrivalMinutes: 18,
          },
        ],
        geometry: {
          coordinates: [
            [26.1445, 91.7362] as [number, number],
            [26.162, 91.741] as [number, number],
            [26.1833, 91.7458] as [number, number],
          ],
          distanceKm: 5.4,
          durationMinutes: 18,
          source: 'OSRM' as const,
        },
      };

      const extracted = extractRouteLatLngs(backendRoute);
      expect(extracted).toEqual(backendRoute.geometry.coordinates);
    });
  });

  describe('Phase 6: Hindi (hi-IN) Localisation Architecture Readiness', () => {
    it('retains en-IN as default active locale and keeps hi-IN disabled pending human review', () => {
      expect(DEFAULT_LOCALE).toBe('en-IN');
      expect(isLocaleEnabled('en-IN')).toBe(true);
      expect(isLocaleEnabled('hi-IN')).toBe(false);
      expect(LOCALE_CATALOGUE['hi-IN'].reviewStatus).toBe('PENDING_HUMAN_REVIEW');
      expect(resolveActiveLocale('hi-IN')).toBe('en-IN');
      expect(resolveActiveLocale(undefined)).toBe('en-IN');
    });

    it('provides complete, safety-compliant en-IN citizen messages and falls back safely for hi-IN', () => {
      const en = getCitizenMessages('en-IN');
      const fallback = getCitizenMessages('hi-IN');
      expect(fallback).toEqual(en);

      expect(en.emergency.callCta).toContain('112');
      expect(en.emergency.footerGuidance).toContain('112');
      expect(en.request.submitImmediateDanger).toContain('112');
      expect(en.confirmation.receiptBadge).toBe('FLOODRELAY REQUEST RECEIPT');
      expect(en.home.step2Footer).toBe('Operator review workflow');

      const serialized = JSON.stringify(en);
      expect(serialized).not.toMatch(/\b911\b|\bHouston\b|\bHarris County\b/i);
    });
  });
});
