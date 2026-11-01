import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Express } from 'express';
import { createApp } from './app.js';
import type { RequestService } from './services/requestService.js';
import type { AssignmentService, AssignmentDetailResponse } from './services/assignmentService.js';
import type { DbAssignment } from './db/schema.js';
import type {
  RescueRequest,
  RouteStop,
  UrgencyLevel,
  RequestStatus,
  VerificationStatus,
  StopType,
  UnservedReason,
} from '@floodrelay/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SchemaObject {
  $ref?: string;
  type?: string;
  required?: string[];
  enum?: string[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  nullable?: boolean;
  format?: string;
  example?: unknown;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<
          string,
          { content?: { 'application/json'?: { schema?: SchemaObject } } }
        >;
      }
    >
  >;
  components?: {
    schemas?: Record<string, SchemaObject>;
  };
}

interface CustomDomainError extends Error {
  code?: string;
  statusCode?: number;
}

function createDomainError(message: string, code: string, statusCode: number): CustomDomainError {
  const err = new Error(message) as CustomDomainError;
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

/**
 * Traverses Express router stack layers to extract registered route methods and normalized paths.
 */
function extractExpressRoutes(app: Express): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];

  interface ExpressLayer {
    route?: {
      path: string;
      methods: Record<string, boolean>;
    };
    name?: string;
    regexp?: RegExp;
    handle?: {
      stack?: ExpressLayer[];
    };
  }

  function walk(stack: ExpressLayer[], prefix = ''): void {
    for (const layer of stack) {
      if (layer.route) {
        const subPath = layer.route.path === '/' && prefix !== '' ? '' : layer.route.path;
        const fullPath = prefix + subPath;
        const openApiPath = fullPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({
            method: method.toUpperCase(),
            path: openApiPath,
          });
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        let mount = '';
        if (layer.regexp) {
          const match = /^\^\\\/([a-zA-Z0-9_-]+)/.exec(layer.regexp.source);
          if (match) {
            mount = '/' + match[1];
          }
        }
        walk(layer.handle.stack, prefix + mount);
      }
    }
  }

  const internalStack = (app as unknown as { _router?: { stack: ExpressLayer[] } })._router?.stack;
  if (internalStack) {
    walk(internalStack);
  }

  return routes;
}

/**
 * Validates a payload against an OpenAPI 3.1 JSON Schema component, throwing on mismatch.
 */
function validateSchema(
  schema: SchemaObject,
  data: unknown,
  contextPath: string,
  rootSpec: OpenApiDocument,
): void {
  if (schema.$ref) {
    const refPath = schema.$ref.replace(/^#\//, '').split('/');
    let resolved: unknown = rootSpec;
    for (const seg of refPath) {
      resolved = (resolved as Record<string, unknown>)?.[seg];
    }
    if (!resolved) {
      throw new Error(`Unresolvable $ref "${schema.$ref}" at ${contextPath}`);
    }
    return validateSchema(resolved as SchemaObject, data, contextPath, rootSpec);
  }

  if (data === null) {
    if (schema.nullable === true) {
      return;
    }
    throw new Error(`Expected non-null value at ${contextPath}`);
  }

  if (data === undefined) {
    throw new Error(`Expected defined value at ${contextPath}`);
  }

  if (schema.type === 'object') {
    if (typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`Expected object at ${contextPath}, received ${typeof data}`);
    }
    const record = data as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (!(reqKey in record) || record[reqKey] === undefined) {
          throw new Error(`Missing required property "${reqKey}" at ${contextPath}`);
        }
      }
    }
    if (schema.properties) {
      for (const [propKey, propVal] of Object.entries(record)) {
        if (schema.properties[propKey]) {
          validateSchema(
            schema.properties[propKey]!,
            propVal,
            `${contextPath}.${propKey}`,
            rootSpec,
          );
        }
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      throw new Error(`Expected array at ${contextPath}, received ${typeof data}`);
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        validateSchema(schema.items, data[i], `${contextPath}[${i}]`, rootSpec);
      }
    }
  } else if (schema.type === 'string') {
    if (typeof data !== 'string') {
      throw new Error(`Expected string at ${contextPath}, received ${typeof data}`);
    }
    if (Array.isArray(schema.enum)) {
      if (!schema.enum.includes(data)) {
        throw new Error(
          `Value "${data}" at ${contextPath} is not in enum: [${schema.enum.join(', ')}]`,
        );
      }
    }
    if (schema.format === 'date-time') {
      if (Number.isNaN(Date.parse(data))) {
        throw new Error(`Value "${data}" at ${contextPath} is not a valid date-time string`);
      }
    }
  } else if (schema.type === 'integer') {
    if (typeof data !== 'number' || !Number.isInteger(data)) {
      throw new Error(`Expected integer at ${contextPath}, received ${String(data)}`);
    }
  } else if (schema.type === 'number') {
    if (typeof data !== 'number' || Number.isNaN(data)) {
      throw new Error(`Expected number at ${contextPath}, received ${String(data)}`);
    }
  } else if (schema.type === 'boolean') {
    if (typeof data !== 'boolean') {
      throw new Error(`Expected boolean at ${contextPath}, received ${typeof data}`);
    }
  }
}

describe('OpenAPI Specification Integrity & Anti-Drift Tests', () => {
  const apiSpecPath = join(__dirname, 'openapi.json');
  const docsSpecPath = join(__dirname, '../../../docs/openapi.json');

  const apiSpecContent = readFileSync(apiSpecPath, 'utf-8');
  const docsSpecContent = readFileSync(docsSpecPath, 'utf-8');
  const spec = JSON.parse(apiSpecContent) as OpenApiDocument;

  function validateResponseAgainstSpec(
    method: string,
    path: string,
    statusCode: number,
    body: unknown,
  ): void {
    const pathItem = spec.paths[path];
    expect(pathItem, `Path "${path}" not found in spec.paths`).toBeDefined();
    const operation = pathItem?.[method.toLowerCase()];
    expect(operation, `Method [${method}] not found for path "${path}" in spec`).toBeDefined();
    const responseDef = operation?.responses?.[String(statusCode)];
    expect(
      responseDef,
      `Status code ${statusCode} not documented for [${method}] ${path}`,
    ).toBeDefined();
    const responseSchema = responseDef?.content?.['application/json']?.schema;
    expect(
      responseSchema,
      `No JSON schema defined for [${method}] ${path} (${statusCode})`,
    ).toBeDefined();

    validateSchema(responseSchema!, body, `[${method}] ${path} (${statusCode}) body`, spec);
  }

  it('ensures services/api/src/openapi.json and docs/openapi.json are byte-for-byte identical and synchronized', () => {
    expect(apiSpecContent).toBe(docsSpecContent);
    expect(JSON.parse(apiSpecContent)).toEqual(JSON.parse(docsSpecContent));
  });

  it('validates OpenAPI document structure and metadata', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Flood Rescue Resource Allocation Platform API');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.servers).toBeInstanceOf(Array);
    expect(spec.servers.length).toBeGreaterThan(0);
    expect(spec.paths).toBeDefined();
    expect(spec.components?.schemas).toBeDefined();
  });

  it('serves OpenAPI spec at GET /openapi.json with HTTP 200', async () => {
    const app = createApp();
    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('Flood Rescue Resource Allocation Platform API');
    validateResponseAgainstSpec('GET', '/openapi.json', 200, res.body);
  });

  it('verifies that every registered Express endpoint is documented in the OpenAPI specification (zero drift)', () => {
    const app = createApp();
    const registeredRoutes = extractExpressRoutes(app);

    expect(registeredRoutes.length).toBeGreaterThan(0);

    for (const route of registeredRoutes) {
      const pathItem = spec.paths[route.path];
      expect(
        pathItem,
        `Express route [${route.method}] ${route.path} is missing from OpenAPI spec.paths`,
      ).toBeDefined();

      const operation = pathItem?.[route.method.toLowerCase()];
      expect(
        operation,
        `Method [${route.method}] for path ${route.path} is missing from OpenAPI spec`,
      ).toBeDefined();
    }
  });

  it('verifies that every OpenAPI operation corresponds to a real registered Express route (no phantom endpoints)', () => {
    const app = createApp();
    const registeredRoutes = extractExpressRoutes(app);

    for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
      for (const methodStr of Object.keys(pathItem)) {
        const method = methodStr.toUpperCase();
        const exists = registeredRoutes.some((r) => r.path === pathStr && r.method === method);
        expect(
          exists,
          `OpenAPI operation [${method}] ${pathStr} has no corresponding registered Express route`,
        ).toBe(true);
      }
    }
  });

  it('verifies that all component $ref references resolve to defined schemas', () => {
    const schemas = spec.components?.schemas ?? {};
    const specString = JSON.stringify(spec);

    const refRegex = /"\$ref":\s*"#\/components\/schemas\/([a-zA-Z0-9_]+)"/g;
    let match: RegExpExecArray | null;

    const referencedSchemas = new Set<string>();
    while ((match = refRegex.exec(specString)) !== null) {
      referencedSchemas.add(match[1]!);
    }

    expect(referencedSchemas.size).toBeGreaterThan(0);
    for (const schemaName of referencedSchemas) {
      expect(
        schemas[schemaName],
        `Schema "$ref: #/components/schemas/${schemaName}" is referenced but not defined in components.schemas`,
      ).toBeDefined();
    }
  });

  describe('OpenAPI Schemas vs @floodrelay/shared Types Contract Parity', () => {
    it('matches UrgencyLevel enum values with @floodrelay/shared', () => {
      const openApiUrgency = spec.components?.schemas?.['UrgencyLevel']?.enum;
      const expected: UrgencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      expect(openApiUrgency).toEqual(expected);
    });

    it('matches RequestStatus enum values with @floodrelay/shared', () => {
      const openApiStatus = spec.components?.schemas?.['RequestStatus']?.enum;
      const expected: RequestStatus[] = [
        'PENDING',
        'ASSIGNED',
        'IN_TRANSIT',
        'RESCUED',
        'CANCELLED',
      ];
      expect(openApiStatus).toEqual(expected);
    });

    it('matches VerificationStatus enum values with @floodrelay/shared', () => {
      const openApiVerif = spec.components?.schemas?.['VerificationStatus']?.enum;
      const expected: VerificationStatus[] = ['UNVERIFIED', 'VERIFIED', 'REJECTED'];
      expect(openApiVerif).toEqual(expected);
    });

    it('matches StopType enum values with @floodrelay/shared', () => {
      const openApiStopType = spec.components?.schemas?.['StopType']?.enum;
      const expected: StopType[] = ['PICKUP', 'DROPOFF', 'DEPOT'];
      expect(openApiStopType).toEqual(expected);
    });

    it('matches UnservedReason enum values with @floodrelay/shared', () => {
      const openApiUnserved = spec.components?.schemas?.['UnservedReason']?.enum;
      const expected: UnservedReason[] = [
        'CAPACITY_EXCEEDED',
        'NO_REACHABLE_RESOURCE',
        'TIME_WINDOW_EXCEEDED',
        'ISOLATED_ZONE',
        'GROUP_LARGER_THAN_ANY_VEHICLE',
        'SHIFT_LIMIT_REACHED',
        'UNREACHABLE_DUE_TO_HAZARD',
      ];
      expect(openApiUnserved).toEqual(expected);
    });

    it('validates RescueRequestResponse fields cover @floodrelay/shared RescueRequest contract', () => {
      const schema = spec.components?.schemas?.['RescueRequestResponse'];
      expect(schema?.required).toEqual(
        expect.arrayContaining([
          'id',
          'lat',
          'lng',
          'peopleCount',
          'urgency',
          'source',
          'status',
          'verificationStatus',
          'medicalNeeds',
          'isFlaggedDuplicate',
          'createdAt',
        ]),
      );
    });

    it('validates RouteStop schema fields cover @floodrelay/shared RouteStop contract', () => {
      const schema = spec.components?.schemas?.['RouteStop'];
      expect(schema?.required).toEqual(
        expect.arrayContaining([
          'stopNumber',
          'type',
          'targetId',
          'lat',
          'lng',
          'passengersPickedUp',
          'passengersDroppedOff',
          'estimatedArrivalMinutes',
        ]),
      );
    });

    it('validates ResourceRoute schema fields cover @floodrelay/shared ResourceRoute contract', () => {
      const schema = spec.components?.schemas?.['ResourceRoute'];
      expect(schema?.required).toEqual(
        expect.arrayContaining([
          'resourceId',
          'stops',
          'totalTravelDistanceKm',
          'totalDurationMinutes',
          'servedRequestIds',
        ]),
      );
    });

    it('validates SolverMetrics schema fields cover @floodrelay/shared SolverMetrics contract', () => {
      const schema = spec.components?.schemas?.['SolverMetrics'];
      expect(schema?.required).toEqual(
        expect.arrayContaining([
          'coveragePercent',
          'totalTravelTimeMinutes',
          'totalTravelDistanceKm',
          'highPriorityWaitTimeMinutes',
          'solveDurationMs',
          'servedRequestsCount',
          'unservedRequestsCount',
        ]),
      );
    });
  });

  describe('Live Supertest Response Body Schema Validation (Success & Error)', () => {
    const mockRescueRequest: RescueRequest = {
      id: 'req_123',
      lat: 28.695,
      lng: 77.23,
      peopleCount: 4,
      urgency: 'HIGH',
      source: 'REPORTED',
      status: 'PENDING',
      verificationStatus: 'UNVERIFIED',
      medicalNeeds: false,
      notes: 'Water at chest height',
      idempotencyKey: 'idemp_key_1',
      isFlaggedDuplicate: false,
      duplicateOfId: null,
      createdAt: '2026-10-29T10:00:00.000Z',
    };

    const mockRouteStop: RouteStop = {
      stopNumber: 1,
      type: 'PICKUP',
      targetId: 'req_123',
      lat: 28.695,
      lng: 77.23,
      passengersPickedUp: 4,
      passengersDroppedOff: 0,
      estimatedArrivalMinutes: 15.5,
      isFrozen: false,
    };

    const mockAssignmentDetail: AssignmentDetailResponse = {
      id: 'assign_456',
      scenarioId: 'scenario-delhi-yamuna-demo',
      status: 'PROPOSED',
      committedAt: null,
      committedBy: null,
      metrics: {
        coveragePercent: 100,
        totalTravelTimeMinutes: 45.2,
        totalTravelDistanceKm: 8.5,
        highPriorityWaitTimeMinutes: 12.0,
        solveDurationMs: 15,
        servedRequestsCount: 1,
        unservedRequestsCount: 0,
      },
      unserved: [],
      routes: [
        {
          resourceId: 'boat_01',
          stops: [mockRouteStop],
          totalTravelDistanceKm: 8.5,
          totalDurationMinutes: 45.2,
          servedRequestIds: ['req_123'],
        },
      ],
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:00:00.000Z',
    };

    const mockAssignmentSummary: DbAssignment = {
      id: 'assign_456',
      scenario_id: 'scenario-delhi-yamuna-demo',
      status: 'PROPOSED',
      committed_at: null,
      committed_by: null,
      metrics: mockAssignmentDetail.metrics,
      unserved: [],
      created_at: new Date('2026-10-29T10:00:00.000Z'),
      updated_at: new Date('2026-10-29T10:00:00.000Z'),
    };

    const mockRequestService = {
      submitRequest: async (input: { idempotencyKey?: string | null }) => {
        if (input.idempotencyKey === 'reused_key') {
          throw createDomainError(
            'Idempotency key reused with different payload',
            'IDEMPOTENCY_KEY_REUSED',
            409,
          );
        }
        if (input.idempotencyKey === 'idempotent_key') {
          return {
            idempotent: true,
            isFlaggedDuplicate: false,
            duplicateOfId: null,
            request: mockRescueRequest,
          };
        }
        return {
          idempotent: false,
          isFlaggedDuplicate: false,
          duplicateOfId: null,
          request: mockRescueRequest,
        };
      },
      getRequest: async (id: string) => {
        if (id === 'req_123') return mockRescueRequest;
        return null;
      },
      listRequests: async () => {
        return [mockRescueRequest];
      },
    } as unknown as RequestService;

    const mockAssignmentService = {
      proposeAssignment: async (input: { scenarioId?: string | null }) => {
        if (input.scenarioId === 'non_existent_scenario') {
          throw createDomainError('Scenario not found', 'NOT_FOUND', 404);
        }
        return mockAssignmentDetail;
      },
      listAssignments: async () => {
        return [mockAssignmentSummary];
      },
      getAssignment: async (id: string) => {
        if (id === 'assign_456') return mockAssignmentDetail;
        if (id === 'assign_committed') {
          return {
            ...mockAssignmentDetail,
            id: 'assign_committed',
            status: 'COMMITTED',
            committedAt: '2026-10-29T11:00:00.000Z',
            committedBy: 'operator_1',
          };
        }
        return null;
      },
      commitAssignment: async (id: string) => {
        if (id === 'assign_committed') {
          throw createDomainError('Plan is already committed', 'ALREADY_COMMITTED', 409);
        }
        if (id === 'assign_not_found') {
          throw createDomainError('Assignment not found', 'NOT_FOUND', 404);
        }
        return true;
      },
      modifyStop: async (id: string) => {
        if (id === 'assign_not_found') {
          throw createDomainError('Assignment not found', 'NOT_FOUND', 404);
        }
        if (id === 'assign_committed') {
          throw createDomainError(
            'Cannot modify stops on committed plan',
            'CANNOT_MODIFY_COMMITTED',
            409,
          );
        }
        return mockRouteStop;
      },
    } as unknown as AssignmentService;

    const app = createApp({
      requestService: mockRequestService,
      assignmentService: mockAssignmentService,
    });

    it('validates GET /health (200 OK)', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      validateResponseAgainstSpec('GET', '/health', 200, res.body);
    });

    it('validates POST /requests (201 Created)', async () => {
      const res = await request(app).post('/requests').send({
        lat: 28.695,
        lng: 77.23,
        peopleCount: 4,
        urgency: 'HIGH',
      });
      expect(res.status).toBe(201);
      validateResponseAgainstSpec('POST', '/requests', 201, res.body);
    });

    it('validates POST /requests (200 Idempotent Replay)', async () => {
      const res = await request(app).post('/requests').send({
        lat: 28.695,
        lng: 77.23,
        peopleCount: 4,
        urgency: 'HIGH',
        idempotencyKey: 'idempotent_key',
      });
      expect(res.status).toBe(200);
      validateResponseAgainstSpec('POST', '/requests', 200, res.body);
    });

    it('validates POST /requests (400 Bad Request)', async () => {
      const res = await request(app).post('/requests').send({
        lat: 999.0, // Invalid latitude
        lng: 77.23,
        peopleCount: 4,
        urgency: 'HIGH',
      });
      expect(res.status).toBe(400);
      validateResponseAgainstSpec('POST', '/requests', 400, res.body);
    });

    it('validates POST /requests (409 Conflict: Idempotency Key Reused)', async () => {
      const res = await request(app).post('/requests').send({
        lat: 28.695,
        lng: 77.23,
        peopleCount: 4,
        urgency: 'HIGH',
        idempotencyKey: 'reused_key',
      });
      expect(res.status).toBe(409);
      validateResponseAgainstSpec('POST', '/requests', 409, res.body);
    });

    it('validates GET /requests (200 OK)', async () => {
      const res = await request(app).get('/requests');
      expect(res.status).toBe(200);
      validateResponseAgainstSpec('GET', '/requests', 200, res.body);
    });

    it('validates GET /requests (400 Bad Request on invalid query filter)', async () => {
      const res = await request(app).get('/requests?urgency=INVALID_URGENCY');
      expect(res.status).toBe(400);
      validateResponseAgainstSpec('GET', '/requests', 400, res.body);
    });

    it('validates GET /requests/{id} (200 OK)', async () => {
      const res = await request(app).get('/requests/req_123');
      expect(res.status).toBe(200);
      validateResponseAgainstSpec('GET', '/requests/{id}', 200, res.body);
    });

    it('validates GET /requests/{id} (404 Not Found)', async () => {
      const res = await request(app).get('/requests/req_unknown');
      expect(res.status).toBe(404);
      validateResponseAgainstSpec('GET', '/requests/{id}', 404, res.body);
    });

    it('validates POST /assignments/propose (201 Created)', async () => {
      const res = await request(app).post('/assignments/propose').send({});
      expect(res.status).toBe(201);
      validateResponseAgainstSpec('POST', '/assignments/propose', 201, res.body);
    });

    it('validates POST /assignments/propose (400 Bad Request)', async () => {
      const res = await request(app).post('/assignments/propose').send({
        algorithm: 'invalid_algorithm_name',
      });
      expect(res.status).toBe(400);
      validateResponseAgainstSpec('POST', '/assignments/propose', 400, res.body);
    });

    it('validates GET /assignments (200 OK)', async () => {
      const res = await request(app).get('/assignments');
      expect(res.status).toBe(200);
      validateResponseAgainstSpec('GET', '/assignments', 200, res.body);
    });

    it('validates GET /assignments (400 Bad Request on invalid query)', async () => {
      const res = await request(app).get('/assignments?status=INVALID_STATUS');
      expect(res.status).toBe(400);
      validateResponseAgainstSpec('GET', '/assignments', 400, res.body);
    });

    it('validates GET /assignments/{id} (200 OK)', async () => {
      const res = await request(app).get('/assignments/assign_456');
      expect(res.status).toBe(200);
      validateResponseAgainstSpec('GET', '/assignments/{id}', 200, res.body);
    });

    it('validates GET /assignments/{id} (404 Not Found)', async () => {
      const res = await request(app).get('/assignments/assign_unknown');
      expect(res.status).toBe(404);
      validateResponseAgainstSpec('GET', '/assignments/{id}', 404, res.body);
    });

    it('validates POST /assignments/{id}/commit (200 OK)', async () => {
      const res = await request(app).post('/assignments/assign_456/commit').send({
        operatorId: 'operator_karan',
      });
      expect(res.status).toBe(200);
      validateResponseAgainstSpec('POST', '/assignments/{id}/commit', 200, res.body);
    });

    it('validates POST /assignments/{id}/commit (400 Bad Request on missing operatorId)', async () => {
      const res = await request(app).post('/assignments/assign_456/commit').send({});
      expect(res.status).toBe(400);
      validateResponseAgainstSpec('POST', '/assignments/{id}/commit', 400, res.body);
    });

    it('validates POST /assignments/{id}/commit (404 Not Found)', async () => {
      const res = await request(app).post('/assignments/assign_not_found/commit').send({
        operatorId: 'operator_karan',
      });
      expect(res.status).toBe(404);
      validateResponseAgainstSpec('POST', '/assignments/{id}/commit', 404, res.body);
    });

    it('validates POST /assignments/{id}/commit (409 Conflict: Already Committed)', async () => {
      const res = await request(app).post('/assignments/assign_committed/commit').send({
        operatorId: 'operator_karan',
      });
      expect(res.status).toBe(409);
      validateResponseAgainstSpec('POST', '/assignments/{id}/commit', 409, res.body);
    });

    it('validates PATCH /assignments/{id}/stops/{stopId} (200 OK)', async () => {
      const res = await request(app).patch('/assignments/assign_456/stops/stop_1').send({
        isFrozen: true,
      });
      expect(res.status).toBe(200);
      validateResponseAgainstSpec('PATCH', '/assignments/{id}/stops/{stopId}', 200, res.body);
    });

    it('validates PATCH /assignments/{id}/stops/{stopId} (400 Bad Request)', async () => {
      const res = await request(app).patch('/assignments/assign_456/stops/stop_1').send({
        stopNumber: -1, // Invalid stopNumber
      });
      expect(res.status).toBe(400);
      validateResponseAgainstSpec('PATCH', '/assignments/{id}/stops/{stopId}', 400, res.body);
    });

    it('validates PATCH /assignments/{id}/stops/{stopId} (404 Not Found)', async () => {
      const res = await request(app).patch('/assignments/assign_not_found/stops/stop_1').send({
        isFrozen: true,
      });
      expect(res.status).toBe(404);
      validateResponseAgainstSpec('PATCH', '/assignments/{id}/stops/{stopId}', 404, res.body);
    });

    it('validates PATCH /assignments/{id}/stops/{stopId} (409 Conflict: Cannot Modify Committed)', async () => {
      const res = await request(app).patch('/assignments/assign_committed/stops/stop_1').send({
        isFrozen: true,
      });
      expect(res.status).toBe(409);
      validateResponseAgainstSpec('PATCH', '/assignments/{id}/stops/{stopId}', 409, res.body);
    });
  });
});
