import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  STAGED_SECTOR_FLEET,
  STAGED_SECTOR_SHELTERS,
  STAGED_SECTOR_BLOCKED_ZONES,
  MAP_SCENARIO_NAME,
  MAP_SCENARIO_COORDINATES,
  TACTICAL_MAP_DEFAULT_CENTRE,
  TACTICAL_MAP_DEFAULT_ZOOM,
} from '../lib/fixtures/mapReferenceData';
import { REGION_CONFIG } from '../lib/region';

describe('Operator Map Reference Data & Native Delhi Coordinate Invariants', () => {
  it('(a) exposes centralised Delhi–Yamuna tactical map centre derived from REGION_CONFIG without rebasing', () => {
    expect(TACTICAL_MAP_DEFAULT_CENTRE).toEqual([
      REGION_CONFIG.tacticalDemoCentre.lat,
      REGION_CONFIG.tacticalDemoCentre.lng,
    ]);
    expect(TACTICAL_MAP_DEFAULT_CENTRE[0]).toBeCloseTo(28.671, 4);
    expect(TACTICAL_MAP_DEFAULT_CENTRE[1]).toBeCloseTo(77.234, 4);
    expect(TACTICAL_MAP_DEFAULT_ZOOM).toBe(REGION_CONFIG.tacticalDemoZoom);
  });

  it('(b) fixture data matches real seed file scenarios/sample-scenario.json exactly', () => {
    const seedPath = path.resolve(__dirname, '../../../scenarios/sample-scenario.json');
    expect(fs.existsSync(seedPath)).toBe(true);

    const seedRaw = fs.readFileSync(seedPath, 'utf8');
    const seed = JSON.parse(seedRaw);

    // Scenario metadata
    expect(MAP_SCENARIO_NAME).toBe(seed.metadata.name);
    expect(MAP_SCENARIO_NAME).toBe('Yamuna Flood Relief - North Delhi Basin (Simulated)');
    expect(MAP_SCENARIO_COORDINATES).toBe('28.67° N, 77.23° E');

    // Resources comparison (IDs, names, types, capacities, speeds, coordinates, provenance)
    expect(STAGED_SECTOR_FLEET).toHaveLength(seed.resources.length);
    seed.resources.forEach(
      (seedRes: {
        id: string;
        name: string;
        type: string;
        capacity: number;
        speedKmH: number;
        lat: number;
        lng: number;
        source?: string;
      }) => {
        const match = STAGED_SECTOR_FLEET.find((r) => r.id === seedRes.id);
        expect(match).toBeDefined();
        expect(match?.name).toBe(seedRes.name);
        expect(match?.type).toBe(seedRes.type);
        expect(match?.capacity).toBe(seedRes.capacity);
        expect(match?.speedKmH).toBe(seedRes.speedKmH);
        expect(match?.lat).toBe(seedRes.lat);
        expect(match?.lng).toBe(seedRes.lng);
        expect(match?.source).toBe('SIMULATED');
        expect(seedRes.source).toBe('SIMULATED');
      },
    );

    // Shelters comparison (IDs, names, capacities, occupancy headroom, coordinates, provenance)
    expect(STAGED_SECTOR_SHELTERS).toHaveLength(seed.shelters.length);
    seed.shelters.forEach(
      (seedShelter: {
        id: string;
        name: string;
        capacity: number;
        currentOccupancy?: number;
        lat: number;
        lng: number;
        source?: string;
      }) => {
        const match = STAGED_SECTOR_SHELTERS.find((s) => s.id === seedShelter.id);
        expect(match).toBeDefined();
        expect(match?.name).toBe(seedShelter.name);
        expect(match?.capacity).toBe(seedShelter.capacity);
        expect(match?.availableBeds).toBe(
          seedShelter.capacity - (seedShelter.currentOccupancy ?? 0),
        );
        expect(match?.lat).toBe(seedShelter.lat);
        expect(match?.lng).toBe(seedShelter.lng);
        expect(match?.source).toBe('SIMULATED');
        expect(seedShelter.source).toBe('SIMULATED');
      },
    );

    // Blocked zones comparison (IDs, names, severities, polygon vertices)
    expect(STAGED_SECTOR_BLOCKED_ZONES).toHaveLength(seed.blockedZones.length);
    seed.blockedZones.forEach(
      (seedZone: {
        id: string;
        name: string;
        severity: string;
        polygon: { lat: number; lng: number }[];
      }) => {
        const match = STAGED_SECTOR_BLOCKED_ZONES.find((z) => z.id === seedZone.id);
        expect(match).toBeDefined();
        expect(match?.name).toBe(seedZone.name);
        expect(match?.severity).toBe(seedZone.severity);
        expect(match?.polygon).toHaveLength(seedZone.polygon.length);
        seedZone.polygon.forEach((pt: { lat: number; lng: number }, idx: number) => {
          expect(match?.polygon[idx]?.lat).toBe(pt.lat);
          expect(match?.polygon[idx]?.lng).toBe(pt.lng);
        });
        expect(match?.source).toBe('SIMULATED');
      },
    );
  });

  it('(c) scans operator/map, components/operator/map, mapReferenceData and repairFixtures for forbidden legacy patterns', () => {
    const targets = [
      path.resolve(__dirname, '../app/operator/map'),
      path.resolve(__dirname, '../components/operator/map'),
      path.resolve(__dirname, '../lib/fixtures/mapReferenceData.ts'),
      path.resolve(__dirname, '../lib/fixtures/repairFixtures.ts'),
    ];

    const forbiddenPatterns = [
      /\bharris\b/i,
      /\bhouston\b/i,
      /buffalo\s+bayou/i,
      /\bheights\b/i,
      /\bwestchase\b/i,
      /\bnrg\b/i,
      /95\.36/i,
      /rebaseLatLng/,
      /HOUSTON_ANCHOR/,
      /cartocdn/i,
      /carto\.com/i,
      /Sector 4/i,
      /Standby Roster/i,
      /Z-402/i,
      /Z-405/i,
    ];

    const filesToScan: string[] = [];
    function collectFiles(targetPath: string) {
      const stat = fs.statSync(targetPath);
      if (stat.isFile()) {
        filesToScan.push(targetPath);
        return;
      }
      const entries = fs.readdirSync(targetPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
          collectFiles(fullPath);
        } else if (/\.(tsx?|jsx?|css)$/.test(entry.name)) {
          filesToScan.push(fullPath);
        }
      }
    }

    targets.forEach((t) => collectFiles(t));
    expect(filesToScan.length).toBeGreaterThanOrEqual(6);

    for (const filePath of filesToScan) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const pattern of forbiddenPatterns) {
        const match = content.match(pattern);
        expect(
          match,
          `File ${path.basename(filePath)} contains forbidden legacy pattern ${pattern}`,
        ).toBeNull();
      }
    }
  });
});
