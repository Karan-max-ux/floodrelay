import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { classifyScenarioProvenance, deriveRegionFromCoordinates } from './assignmentService.js';
import type { RescueRequest, RescueResource, Shelter, Scenario } from '@floodrelay/shared';

describe('DB-Free Unit Tests: classifyScenarioProvenance and deriveRegionFromCoordinates', () => {
  describe('classifyScenarioProvenance', () => {
    it('handles empty scenario entities by defaulting to operational REAL with simulated: false', () => {
      const result = classifyScenarioProvenance([], [], []);
      expect(result).toEqual({
        provenance: 'REAL',
        simulated: false,
        syntheticDataNote: undefined,
        description: 'Empty operational scenario constructed from stored platform data',
      });
    });

    it('classifies scenario with purely real entities as REAL with simulated: false', () => {
      const requests: RescueRequest[] = [
        {
          id: 'req_real_1',
          lat: 28.7,
          lng: 77.2,
          peopleCount: 2,
          urgency: 'HIGH',
          source: 'REPORTED',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
      ];
      const resources: RescueResource[] = [
        {
          id: 'res_real_1',
          name: 'Real Boat',
          type: 'BOAT',
          capacity: 6,
          speedKmH: 25,
          lat: 28.71,
          lng: 77.21,
          status: 'AVAILABLE',
          source: 'REAL',
        },
      ];
      const shelters: Shelter[] = [
        {
          id: 'sh_real_1',
          name: 'Real Shelter',
          lat: 28.72,
          lng: 77.22,
          capacity: 100,
          source: 'REAL',
        },
      ];

      const result = classifyScenarioProvenance(requests, resources, shelters);
      expect(result.provenance).toBe('REAL');
      expect(result.simulated).toBe(false);
      expect(result.syntheticDataNote).toBeUndefined();
      expect(result.description).toContain('real-world platform data');
    });

    it('classifies scenario with purely simulated entities as SIMULATED with simulated: true', () => {
      const requests: RescueRequest[] = [
        {
          id: 'req_sim_1',
          lat: 28.7,
          lng: 77.2,
          peopleCount: 4,
          urgency: 'CRITICAL',
          source: 'SIMULATED',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
      ];
      const resources: RescueResource[] = [
        {
          id: 'res_sim_1',
          name: 'Simulated Boat',
          type: 'BOAT',
          capacity: 8,
          speedKmH: 30,
          lat: 28.71,
          lng: 77.21,
          status: 'AVAILABLE',
          source: 'SIMULATED',
        },
      ];
      const shelters: Shelter[] = [
        {
          id: 'sh_sim_1',
          name: 'Simulated Shelter',
          lat: 28.72,
          lng: 77.22,
          capacity: 150,
          source: 'SIMULATED',
        },
      ];

      const result = classifyScenarioProvenance(requests, resources, shelters);
      expect(result.provenance).toBe('SIMULATED');
      expect(result.simulated).toBe(true);
      expect(result.syntheticDataNote).toBe(
        'PROPOSED dispatch scenario generated on simulated platform data',
      );
      expect(result.description).toContain('synthetic platform data');
    });

    it('classifies mixed-provenance scenarios with provenance: MIXED, simulated: undefined, and exact counts in note', () => {
      const requests: RescueRequest[] = [
        {
          id: 'req_real',
          lat: 28.7,
          lng: 77.2,
          peopleCount: 2,
          urgency: 'HIGH',
          source: 'REPORTED',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'req_sim',
          lat: 28.71,
          lng: 77.21,
          peopleCount: 3,
          urgency: 'MEDIUM',
          source: 'SIMULATED',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
      ];
      const resources: RescueResource[] = [
        {
          id: 'res_sim',
          name: 'Simulated Boat',
          type: 'BOAT',
          capacity: 6,
          speedKmH: 25,
          lat: 28.72,
          lng: 77.22,
          status: 'AVAILABLE',
          source: 'SIMULATED',
        },
      ];
      const shelters: Shelter[] = [
        {
          id: 'sh_real',
          name: 'Real Shelter',
          lat: 28.73,
          lng: 77.23,
          capacity: 100,
          source: 'REAL',
        },
      ];

      // 2 real entities (req_real, sh_real) and 2 simulated entities (req_sim, res_sim)
      const result = classifyScenarioProvenance(requests, resources, shelters);
      expect(result.provenance).toBe('MIXED');
      expect(result.simulated).toBeUndefined();
      expect(result.syntheticDataNote).toBe(
        'MIXED PROVENANCE: Scenario incorporates both real-world (2) and simulated (2) operational entities',
      );
      expect(result.description).toBe(
        'Mixed-provenance dispatch scenario combining 2 real-world and 2 synthetic entities',
      );
    });

    it('safely ignores null, undefined, or unrecognized source values and handles legacy source: REAL on requests', () => {
      const requests: RescueRequest[] = [
        {
          id: 'req_legacy_real',
          lat: 28.7,
          lng: 77.2,
          peopleCount: 2,
          urgency: 'HIGH',
          // Test legacy 'REAL' source string on requests
          source: 'REAL' as unknown as 'REPORTED',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'req_unrecognized',
          lat: 28.71,
          lng: 77.21,
          peopleCount: 3,
          urgency: 'LOW',
          // Unrecognized source string
          source: 'UNRECOGNIZED_SOURCE' as unknown as 'REPORTED',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
      ];
      const resources: RescueResource[] = [
        {
          id: 'res_null_src',
          name: 'Unknown Resource',
          type: 'BOAT',
          capacity: 4,
          speedKmH: 20,
          lat: 28.72,
          lng: 77.22,
          status: 'AVAILABLE',
          source: null as unknown as 'REAL',
        },
      ];
      const shelters: Shelter[] = [
        {
          id: 'sh_undefined_src',
          name: 'Unknown Shelter',
          lat: 28.73,
          lng: 77.23,
          capacity: 50,
          source: undefined as unknown as 'REAL',
        },
      ];

      // Only req_legacy_real is counted (as 1 real entity). Unrecognized/null/undefined are ignored safely.
      const result = classifyScenarioProvenance(requests, resources, shelters);
      expect(result.provenance).toBe('REAL');
      expect(result.simulated).toBe(false);
    });

    it('correctly classifies when only a subset of entity types is present', () => {
      // Scenario with only resources (all simulated)
      const resources: RescueResource[] = [
        {
          id: 'res_sim_only',
          name: 'Simulated Boat Only',
          type: 'BOAT',
          capacity: 5,
          speedKmH: 20,
          lat: 28.7,
          lng: 77.2,
          status: 'AVAILABLE',
          source: 'SIMULATED',
        },
      ];
      const result = classifyScenarioProvenance([], resources, []);
      expect(result.provenance).toBe('SIMULATED');
      expect(result.simulated).toBe(true);
    });
  });

  describe('deriveRegionFromCoordinates', () => {
    it('returns unspecified operational area for an empty points array', () => {
      const region = deriveRegionFromCoordinates([]);
      expect(region).toBe('Operational Area (Unspecified)');
    });

    it('correctly maps center coordinates to all 8 configured regions', () => {
      // 1. Delhi NCR / Yamuna Floodplain (lat: 28.3..28.9, lng: 76.8..77.5)
      expect(deriveRegionFromCoordinates([{ lat: 28.61, lng: 77.2 }])).toBe(
        'Delhi NCR / Yamuna Floodplain',
      );

      // 2. Mumbai Metropolitan / Konkan Coast (lat: 18.8..19.4, lng: 72.7..73.2)
      expect(deriveRegionFromCoordinates([{ lat: 19.07, lng: 72.87 }])).toBe(
        'Mumbai Metropolitan / Konkan Coast',
      );

      // 3. Kerala Flood Region (lat: 8.2..12.9, lng: 74.8..77.6)
      expect(deriveRegionFromCoordinates([{ lat: 10.0, lng: 76.25 }])).toBe('Kerala Flood Region');

      // 4. Assam / Brahmaputra Basin (lat: 25.5..28.2, lng: 89.5..96.2)
      expect(deriveRegionFromCoordinates([{ lat: 26.15, lng: 91.75 }])).toBe(
        'Assam / Brahmaputra Basin',
      );

      // 5. Bihar / Middle Ganga Basin (lat: 24.8..26.8, lng: 83.8..88.2)
      expect(deriveRegionFromCoordinates([{ lat: 25.6, lng: 85.1 }])).toBe(
        'Bihar / Middle Ganga Basin',
      );

      // 6. Chennai Metropolitan Area (lat: 12.8..13.4, lng: 80.0..80.4)
      expect(deriveRegionFromCoordinates([{ lat: 13.08, lng: 80.25 }])).toBe(
        'Chennai Metropolitan Area',
      );

      // 7. Kolkata / Lower Ganga Basin (lat: 22.3..23.0, lng: 88.1..88.6)
      expect(deriveRegionFromCoordinates([{ lat: 22.57, lng: 88.35 }])).toBe(
        'Kolkata / Lower Ganga Basin',
      );

      // 8. Gulf Coast / Greater Houston Region (lat: 29.0..31.0, lng: -96.0..-94.0)
      expect(deriveRegionFromCoordinates([{ lat: 29.75, lng: -95.35 }])).toBe(
        'Gulf Coast / Greater Houston Region',
      );
    });

    it('correctly maps boundary edge coordinates using inclusive inequalities', () => {
      // Exact lower boundary of Delhi box: lat 28.3, lng 76.8
      expect(deriveRegionFromCoordinates([{ lat: 28.3, lng: 76.8 }])).toBe(
        'Delhi NCR / Yamuna Floodplain',
      );
      // Exact upper boundary of Delhi box: lat 28.9, lng 77.5
      expect(deriveRegionFromCoordinates([{ lat: 28.9, lng: 77.5 }])).toBe(
        'Delhi NCR / Yamuna Floodplain',
      );
    });

    it('averages multi-point coordinates to locate cluster center', () => {
      const points = [
        { lat: 28.5, lng: 77.1 },
        { lat: 28.7, lng: 77.3 },
      ];
      // center is (28.6, 77.2) -> Delhi
      expect(deriveRegionFromCoordinates(points)).toBe('Delhi NCR / Yamuna Floodplain');
    });

    it('formats unconfigured coordinates with correct hemisphere letters (N/S, E/W)', () => {
      // Northern & Eastern: Paris (lat 48.85, lng 2.35)
      expect(deriveRegionFromCoordinates([{ lat: 48.85, lng: 2.35 }])).toBe(
        'Operational Area (48.85°N, 2.35°E)',
      );

      // Southern & Western: Santiago, Chile (-33.45, -70.66)
      expect(deriveRegionFromCoordinates([{ lat: -33.45, lng: -70.66 }])).toBe(
        'Operational Area (33.45°S, 70.66°W)',
      );

      // Southern & Eastern: Sydney, Australia (-33.86, 151.2)
      expect(deriveRegionFromCoordinates([{ lat: -33.86, lng: 151.2 }])).toBe(
        'Operational Area (33.86°S, 151.20°E)',
      );

      // Northern & Western: New York, USA (40.71, -74.01)
      expect(deriveRegionFromCoordinates([{ lat: 40.71, lng: -74.01 }])).toBe(
        'Operational Area (40.71°N, 74.01°W)',
      );
    });

    it('handles extreme coordinates near +-90 latitude and +-180 longitude without crashing', () => {
      expect(deriveRegionFromCoordinates([{ lat: 89.99, lng: 179.99 }])).toBe(
        'Operational Area (89.99°N, 179.99°E)',
      );
      expect(deriveRegionFromCoordinates([{ lat: -89.99, lng: -179.99 }])).toBe(
        'Operational Area (89.99°S, 179.99°W)',
      );
    });

    it('proves that all 8 configured region boxes are mutually disjoint (zero overlap across all 28 pairs)', () => {
      const boxes = [
        {
          name: 'Delhi NCR / Yamuna Floodplain',
          minLat: 28.3,
          maxLat: 28.9,
          minLng: 76.8,
          maxLng: 77.5,
        },
        {
          name: 'Mumbai Metropolitan / Konkan Coast',
          minLat: 18.8,
          maxLat: 19.4,
          minLng: 72.7,
          maxLng: 73.2,
        },
        { name: 'Kerala Flood Region', minLat: 8.2, maxLat: 12.9, minLng: 74.8, maxLng: 77.6 },
        {
          name: 'Assam / Brahmaputra Basin',
          minLat: 25.5,
          maxLat: 28.2,
          minLng: 89.5,
          maxLng: 96.2,
        },
        {
          name: 'Bihar / Middle Ganga Basin',
          minLat: 24.8,
          maxLat: 26.8,
          minLng: 83.8,
          maxLng: 88.2,
        },
        {
          name: 'Chennai Metropolitan Area',
          minLat: 12.8,
          maxLat: 13.4,
          minLng: 80.0,
          maxLng: 80.4,
        },
        {
          name: 'Kolkata / Lower Ganga Basin',
          minLat: 22.3,
          maxLat: 23.0,
          minLng: 88.1,
          maxLng: 88.6,
        },
        {
          name: 'Gulf Coast / Greater Houston Region',
          minLat: 29.0,
          maxLat: 31.0,
          minLng: -96.0,
          maxLng: -94.0,
        },
      ];

      const overlaps: { a: string; b: string }[] = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const latOverlap = Math.max(a.minLat, b.minLat) <= Math.min(a.maxLat, b.maxLat);
          const lngOverlap = Math.max(a.minLng, b.minLng) <= Math.min(a.maxLng, b.maxLng);
          if (latOverlap && lngOverlap) {
            overlaps.push({ a: a.name, b: b.name });
          }
        }
      }

      expect(overlaps).toHaveLength(0);
    });
  });

  describe('Seeded Scenario Regression Test: scenario-delhi-yamuna-demo', () => {
    it('accurately verifies sample scenario provenance and compares derived region/bounds with static metadata', () => {
      const rootCandidate1 = path.resolve(process.cwd(), 'scenarios/sample-scenario.json');
      const rootCandidate2 = path.resolve(process.cwd(), '../../scenarios/sample-scenario.json');
      const scenarioPath = fs.existsSync(rootCandidate1) ? rootCandidate1 : rootCandidate2;
      expect(fs.existsSync(scenarioPath)).toBe(true);

      const scenario: Scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
      expect(scenario.id).toBe('scenario-delhi-yamuna-demo');

      // 1. Provenance Classification: purely simulated scenario
      const classification = classifyScenarioProvenance(
        scenario.requests,
        scenario.resources,
        scenario.shelters,
      );
      expect(classification.provenance).toBe('SIMULATED');
      expect(classification.simulated).toBe(true);
      expect(classification.syntheticDataNote).toBe(
        'PROPOSED dispatch scenario generated on simulated platform data',
      );

      // 2. Region Derivation: all coordinates fall in Yamuna floodplain
      const allPoints = [
        ...scenario.requests.map((r) => ({ lat: r.lat, lng: r.lng })),
        ...scenario.resources.map((r) => ({ lat: r.lat, lng: r.lng })),
        ...scenario.shelters.map((s) => ({ lat: s.lat, lng: s.lng })),
      ];
      const derivedRegion = deriveRegionFromCoordinates(allPoints);
      expect(derivedRegion).toBe('Delhi NCR / Yamuna Floodplain');

      // 3. Comparison with previous static metadata:
      // Static metadata had broad manual region label 'Delhi NCR'
      expect(scenario.metadata.region).toBe('Delhi NCR');
      expect(derivedRegion).toContain('Delhi NCR');

      // Dynamically computed bounding box is strictly within static file's broader bounding box
      const minLat = Math.min(...allPoints.map((p) => p.lat));
      const maxLat = Math.max(...allPoints.map((p) => p.lat));
      const minLng = Math.min(...allPoints.map((p) => p.lng));
      const maxLng = Math.max(...allPoints.map((p) => p.lng));

      expect(minLat).toBeGreaterThanOrEqual(scenario.metadata.bounds.minLat);
      expect(maxLat).toBeLessThanOrEqual(scenario.metadata.bounds.maxLat);
      expect(minLng).toBeGreaterThanOrEqual(scenario.metadata.bounds.minLng);
      expect(maxLng).toBeLessThanOrEqual(scenario.metadata.bounds.maxLng);
    });
  });
});
