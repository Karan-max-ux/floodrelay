import { describe, it, expect } from 'vitest';
import type { RescueRequest, RescueResource, Scenario } from '@floodrelay/shared';
import { PostgisRepository, type Queryable } from './repository.js';
import {
  parseSeedArgs,
  loadScenarioFromFileOrGenerate,
  runScenarioSeeder,
} from '../scripts/seedScenario.js';

function createMockClient(
  queryHandler: (sql: string, values: unknown[]) => Record<string, unknown>[],
): Queryable {
  return {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      sqlOrConfig: string | { text: string; values?: unknown[] },
      values?: unknown[],
    ): Promise<{ rows: R[]; command: string; rowCount: number; oid: number; fields: [] }> {
      const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
      const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];
      const rows = queryHandler(sql, vals) as unknown as R[];
      return {
        rows,
        command: 'SQL',
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  };
}

describe('PostgisRepository SQL Construction & Spatial Operations', () => {
  it('constructs correct PostGIS ST_MakePoint with (lng, lat) order on insertRequest', async () => {
    let capturedSql = '';
    let capturedValues: unknown[] = [];

    const mockClient = createMockClient((sql, values) => {
      capturedSql = sql;
      capturedValues = values;
      return [
        {
          id: 'req_1',
          location: 'POINT(77.228 28.665)',
          people_count: 4,
          urgency: 'HIGH',
          source: 'SIMULATED',
          status: 'PENDING',
          verification_status: 'VERIFIED',
          medical_needs: false,
          notes: 'Terrace rescue',
          idempotency_key: 'idem-123',
          duplicate_of_id: null,
          is_flagged_duplicate: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
    });

    const repo = new PostgisRepository(mockClient);
    const req: RescueRequest = {
      id: 'req_1',
      lat: 28.665,
      lng: 77.228,
      peopleCount: 4,
      urgency: 'HIGH',
      createdAt: '2026-10-27T12:00:00Z',
      source: 'SIMULATED',
    };

    const result = await repo.insertRequest(req, {
      verificationStatus: 'VERIFIED',
      idempotencyKey: 'idem-123',
    });

    expect(capturedSql).toContain('ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography');
    // $2 must be lng (77.228), $3 must be lat (28.665)
    expect(capturedValues[1]).toBe(77.228);
    expect(capturedValues[2]).toBe(28.665);
    expect(capturedValues[4]).toBe('HIGH');
    expect(capturedValues[5]).toBe('SIMULATED');
    expect(result.id).toBe('req_1');
  });

  it('queries spatial proximity using ST_DWithin and ST_Distance in findNearbyRequests', async () => {
    let capturedSql = '';
    let capturedValues: unknown[] = [];

    const mockClient = createMockClient((sql, values) => {
      capturedSql = sql;
      capturedValues = values;
      return [
        {
          id: 'req_nearby',
          lat: 28.666,
          lng: 77.229,
          peopleCount: 3,
          urgency: 'HIGH',
          source: 'REPORTED',
          status: 'PENDING',
          medicalNeeds: false,
          notes: null,
          duplicateOfId: null,
          isFlaggedDuplicate: false,
          createdAt: new Date(),
          distanceMeters: 45.2,
        },
      ];
    });

    const repo = new PostgisRepository(mockClient);
    const nearby = await repo.findNearbyRequests(28.665, 77.228, 500, {
      excludeId: 'req_current',
      status: 'PENDING',
    });

    expect(capturedSql).toContain(
      'ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)',
    );
    expect(capturedSql).toContain(
      'ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)',
    );
    expect(capturedValues[0]).toBe(77.228); // lng
    expect(capturedValues[1]).toBe(28.665); // lat
    expect(capturedValues[2]).toBe(500); // radius meters
    expect(capturedValues).toContain('req_current');
    expect(capturedValues).toContain('PENDING');

    expect(nearby).toHaveLength(1);
    expect(nearby[0]?.distanceMeters).toBeCloseTo(45.2);
  });

  it('inserts and lists resources with correct speed and capacity types', async () => {
    const executedQueries: string[] = [];
    const mockClient = createMockClient((sql) => {
      executedQueries.push(sql);
      return [
        {
          id: 'res_boat_01',
          name: 'Inflatable Boat 1',
          type: 'BOAT',
          capacity: 8,
          speedKmH: 25,
          lat: 28.67,
          lng: 77.23,
          status: 'AVAILABLE',
        },
      ];
    });

    const repo = new PostgisRepository(mockClient);
    const resource: RescueResource = {
      id: 'res_boat_01',
      name: 'Inflatable Boat 1',
      type: 'BOAT',
      capacity: 8,
      speedKmH: 25,
      lat: 28.67,
      lng: 77.23,
      status: 'AVAILABLE',
    };

    await repo.insertResource(resource, 'SIMULATED', 360);
    expect(executedQueries[0]).toContain('INSERT INTO resources');
    expect(executedQueries[0]).toContain('ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography');

    const listed = await repo.listResources({ status: 'AVAILABLE', type: 'BOAT' });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.capacity).toBe(8);
  });

  it('inserts shelter and finds nearest shelters ordered by ST_Distance', async () => {
    let capturedSql = '';
    const mockClient = createMockClient((sql) => {
      capturedSql = sql;
      return [
        {
          id: 'shelter_1',
          name: 'Relief Camp 1',
          lat: 28.68,
          lng: 77.24,
          capacity: 200,
          currentOccupancy: 40,
          distanceMeters: 850.5,
        },
      ];
    });

    const repo = new PostgisRepository(mockClient);
    const nearest = await repo.findNearestShelters(28.67, 77.23, 3);

    expect(capturedSql).toContain(
      'ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)',
    );
    expect(capturedSql).toContain('ORDER BY "distanceMeters" ASC');
    expect(nearest[0]?.name).toBe('Relief Camp 1');
    expect(nearest[0]?.distanceMeters).toBeCloseTo(850.5);
  });

  it('commits assignment, freezes route stops, and records an audit event', async () => {
    const executedQueries: string[] = [];
    const mockClient = createMockClient((sql) => {
      executedQueries.push(sql);
      return [{ id: 'assign_run_42' }];
    });

    const repo = new PostgisRepository(mockClient);
    const committed = await repo.commitAssignment('assign_run_42', 'operator_karan');

    expect(committed).toBe(true);
    // Verifies assignment status update
    expect(executedQueries[0]).toContain("status = 'COMMITTED'");
    // Verifies route stops are frozen
    expect(executedQueries[1]).toContain('UPDATE assignment_stops SET is_frozen = TRUE');
    // Verifies audit event insertion
    expect(executedQueries[2]).toContain('INSERT INTO audit_events');
  });
});

describe('Scenario Loader & Simulation Provenance', () => {
  it('preserves SIMULATED source label on all rows when loading a simulated scenario', async () => {
    const insertedRequests: unknown[][] = [];
    const insertedResources: unknown[][] = [];
    const insertedShelters: unknown[][] = [];
    const auditEvents: unknown[][] = [];

    const mockClient = createMockClient((sql, values) => {
      if (sql.includes('INSERT INTO requests')) {
        insertedRequests.push(values);
        return [{ id: values[0] as string }];
      }
      if (sql.includes('INSERT INTO resources')) {
        insertedResources.push(values);
        return [{ id: values[0] as string }];
      }
      if (sql.includes('INSERT INTO shelters')) {
        insertedShelters.push(values);
        return [{ id: values[0] as string }];
      }
      if (sql.includes('INSERT INTO audit_events')) {
        auditEvents.push(values);
        return [];
      }
      return [];
    });

    const repo = new PostgisRepository(mockClient);

    const testScenario: Scenario = {
      id: 'test-sim-scenario',
      simulated: true,
      metadata: {
        id: 'test-sim-scenario',
        name: 'Simulated Flood Test',
        region: 'Test Region',
        simulated: true,
        createdAt: '2026-10-27T12:00:00Z',
        bounds: { minLat: 28.5, maxLat: 28.7, minLng: 77.1, maxLng: 77.3 },
      },
      requests: [
        {
          id: 'req_s1',
          lat: 28.6,
          lng: 77.2,
          peopleCount: 3,
          urgency: 'HIGH',
          source: 'SIMULATED',
          createdAt: '2026-10-27T12:00:00Z',
        },
        {
          id: 'req_s2',
          lat: 28.61,
          lng: 77.21,
          peopleCount: 2,
          urgency: 'CRITICAL',
          source: 'SIMULATED',
          createdAt: '2026-10-27T12:01:00Z',
        },
      ],
      resources: [
        {
          id: 'res_s1',
          name: 'Boat 1',
          type: 'BOAT',
          capacity: 6,
          speedKmH: 20,
          lat: 28.6,
          lng: 77.2,
          status: 'AVAILABLE',
        },
      ],
      shelters: [
        {
          id: 'sh_s1',
          name: 'Shelter 1',
          lat: 28.62,
          lng: 77.22,
          capacity: 50,
        },
      ],
    };

    const result = await repo.loadScenario(testScenario);

    expect(result.requestsCount).toBe(2);
    expect(result.resourcesCount).toBe(1);
    expect(result.sheltersCount).toBe(1);
    expect(result.isSimulated).toBe(true);

    // Verify all inserted requests have source = 'SIMULATED' (index 5 in values)
    expect(insertedRequests[0]?.[5]).toBe('SIMULATED');
    expect(insertedRequests[1]?.[5]).toBe('SIMULATED');

    // Verify resource source = 'SIMULATED' (index 10 in values)
    expect(insertedResources[0]?.[10]).toBe('SIMULATED');

    // Verify shelter source = 'SIMULATED' (index 6 in values)
    expect(insertedShelters[0]?.[6]).toBe('SIMULATED');

    // Verify audit event was logged
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.[2]).toBe('SCENARIO_LOADED');
  });

  it('parses CLI seed arguments correctly', () => {
    const args = [
      '--file',
      'scenarios/custom.json',
      '--generate',
      '--seed',
      '999',
      '--requests',
      '50',
      '--resources',
      '6',
      '--shelters',
      '3',
      '--dry-run',
    ];

    const parsed = parseSeedArgs(args);
    expect(parsed.generate).toBe(true);
    expect(parsed.seed).toBe(999);
    expect(parsed.requests).toBe(50);
    expect(parsed.resources).toBe(6);
    expect(parsed.shelters).toBe(3);
    expect(parsed.dryRun).toBe(true);
  });

  it('loads and validates sample scenario file scenarios/sample-scenario.json', async () => {
    const options = parseSeedArgs(['--dry-run']);
    const scenario = await loadScenarioFromFileOrGenerate(options);

    expect(scenario.id).toBe('scenario-delhi-yamuna-demo');
    expect(scenario.simulated).toBe(true);
    expect(scenario.requests.length).toBe(5);
    expect(scenario.resources.length).toBe(3);
    expect(scenario.shelters.length).toBe(2);

    // Every single request must have source: 'SIMULATED'
    for (const req of scenario.requests) {
      expect(req.source).toBe('SIMULATED');
    }
  });

  it('runs scenario seeder in dry-run mode without requiring live database', async () => {
    const result = await runScenarioSeeder(['--dry-run']);
    expect(result.scenarioId).toBe('scenario-delhi-yamuna-demo');
    expect(result.requestsCount).toBe(5);
    expect(result.resourcesCount).toBe(3);
    expect(result.sheltersCount).toBe(2);
    expect(result.isSimulated).toBe(true);
  });
});
