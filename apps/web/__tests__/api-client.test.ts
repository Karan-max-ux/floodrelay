import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FloodRelayApiClient } from '../lib/api/client';
import { ApiClientError, isAbortError } from '../lib/api/errors';

export function validateMockAgainstOpenApiSchema(
  schemaName: string,
  mockObj: Record<string, unknown>,
): void {
  const filePath = path.resolve(__dirname, '../../../services/api/src/openapi.json');
  const spec = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let schema: Record<string, unknown> | undefined = spec.components?.schemas?.[schemaName];
  if (!schema && schemaName.includes('.')) {
    const parts = schemaName.split('.');
    schema = spec.components?.schemas?.[parts[0]];
    for (let i = 1; i < parts.length; i++) {
      if (
        schema &&
        typeof schema === 'object' &&
        '$ref' in schema &&
        typeof schema.$ref === 'string'
      ) {
        const refKey = (schema.$ref as string).replace('#/components/schemas/', '');
        schema = spec.components?.schemas?.[refKey];
      }
      schema = (schema?.properties as Record<string, unknown> | undefined)?.[parts[i]] as
        Record<string, unknown> | undefined;
    }
  }
  if (!schema) {
    throw new Error(`Schema ${schemaName} not found in openapi.json`);
  }
  if ('$ref' in schema && typeof schema.$ref === 'string') {
    const refKey = (schema.$ref as string).replace('#/components/schemas/', '');
    schema = spec.components?.schemas?.[refKey];
  }
  const requiredFields: string[] = Array.isArray(schema?.required)
    ? (schema.required as string[])
    : [];
  for (const field of requiredFields) {
    if (mockObj[field] === undefined) {
      throw new Error(`Mock object for ${schemaName} is missing required property: "${field}"`);
    }
  }
}

describe('FloodRelayApiClient', () => {
  let client: FloodRelayApiClient;

  beforeEach(() => {
    client = new FloodRelayApiClient({ baseUrl: 'http://localhost:3000/api/v1' });
    vi.restoreAllMocks();
  });

  it('checks system health successfully', async () => {
    const mockHealth = {
      status: 'healthy',
      timestamp: '2026-10-31T02:00:00Z',
      database: 'connected',
      version: '0.2.0',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockHealth }),
    });

    const res = await client.getHealth();
    expect(res.status).toBe('healthy');
    expect(res.database).toBe('connected');
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/health', expect.anything());
  });

  it('fetches rescue requests with query filters', async () => {
    const mockRequests = [
      {
        id: 'req_1',
        lat: 29.76,
        lng: -95.36,
        peopleCount: 4,
        urgency: 'CRITICAL',
        status: 'PENDING',
        verificationStatus: 'UNVERIFIED',
        createdAt: '2026-10-31T01:00:00Z',
        updatedAt: '2026-10-31T01:00:00Z',
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockRequests }),
    });

    const res = await client.listRequests({ status: 'PENDING', urgency: 'CRITICAL', limit: 10 });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('req_1');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/requests?status=PENDING&urgency=CRITICAL&limit=10',
      expect.anything(),
    );
  });

  it('proposes assignment plans via solver endpoint', async () => {
    const mockProposal = {
      id: 'PR-105',
      status: 'PROPOSED',
      metrics: {
        coveragePercent: 94.2,
        totalTravelTimeMinutes: 48.5,
        totalTravelDistanceKm: 16.4,
        highPriorityWaitTimeMinutes: 14.2,
        solveDurationMs: 42,
        servedRequestsCount: 12,
        unservedRequestsCount: 1,
      },
      createdAt: '2026-10-31T01:45:00Z',
      updatedAt: '2026-10-31T01:48:00Z',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockProposal }),
    });

    const res = await client.proposeAssignment({
      algorithm: 'savings',
      preserveFrozen: true,
    });

    expect(res.id).toBe('PR-105');
    expect(res.status).toBe('PROPOSED');
  });

  it('commits assignment plans with operator ID', async () => {
    const mockCommitted = {
      id: 'PR-105',
      status: 'COMMITTED',
      committedBy: 'Capt. R. Vance',
      committedAt: '2026-10-31T02:00:00Z',
      createdAt: '2026-10-31T01:45:00Z',
      updatedAt: '2026-10-31T02:00:00Z',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockCommitted }),
    });

    const res = await client.commitAssignment('PR-105', {
      operatorId: 'operator_vance',
      notes: 'Authorized for Sector 4 deployment',
    });

    expect(res.status).toBe('COMMITTED');
    expect(res.committedBy).toBe('Capt. R. Vance');
  });

  it('throws ApiClientError with 404 status when resource is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: {
          code: 'NOT_FOUND',
          message: 'Assignment proposal PR-999 not found',
        },
      }),
    });

    await expect(client.getAssignment('PR-999')).rejects.toThrow(ApiClientError);
    await expect(client.getAssignment('PR-999')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiClientError with 409 status on concurrency conflict', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: 'CONCURRENCY_CONFLICT',
          message: 'Assignment plan is already COMMITTED',
        },
      }),
    });

    await expect(client.commitAssignment('COM-204', { operatorId: 'op_1' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONCURRENCY_CONFLICT',
    });
  });

  it('preserves AbortError semantics without wrapping into NETWORK_ERROR when fetch is intentionally aborted', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('signal is aborted without reason', 'AbortError');
    global.fetch = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(abortError);
    });

    const promise = client.listRequests(undefined, controller.signal);
    await expect(promise).rejects.toSatisfy(isAbortError);
    await expect(promise).rejects.not.toBeInstanceOf(ApiClientError);
  });

  it('preserves AbortError when signal is already aborted prior to dispatch', async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = vi
      .fn()
      .mockRejectedValue(new DOMException('This operation was aborted', 'AbortError'));

    const promise = client.listRequests(undefined, controller.signal);
    await expect(promise).rejects.toSatisfy(isAbortError);
    await expect(promise).rejects.not.toBeInstanceOf(ApiClientError);
  });

  it('wraps genuine network connection failures into ApiClientError(NETWORK_ERROR)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(client.listRequests()).rejects.toThrow(ApiClientError);
    await expect(client.listRequests()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      statusCode: 0,
      isNetworkError: true,
    });
  });

  it('authenticates operator via login and sets auth token for subsequent requests', async () => {
    const mockLoginResponse = {
      message: 'Operator authenticated successfully',
      token: 'fake-jwt-token-12345',
      operator: {
        id: 'op-001',
        username: 'commander',
        name: 'Sector Commander',
        role: 'COMMANDER',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockLoginResponse }),
    });

    const result = await client.login('commander', 'SecretPass123!');
    expect(result.token).toBe('fake-jwt-token-12345');
    expect(result.operator.username).toBe('commander');
    expect(client.getAuthToken()).toBe('fake-jwt-token-12345');

    // Subsequent requests must carry Authorization header
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          operator: {
            id: 'op-001',
            username: 'commander',
            name: 'Sector Commander',
            role: 'COMMANDER',
          },
        },
      }),
    });

    const me = await client.getMe();
    expect(me.username).toBe('commander');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-jwt-token-12345',
        }),
      }),
    );
  });

  it('clears auth token upon operator logout', async () => {
    client.setAuthToken('existing-session-token');
    expect(client.getAuthToken()).toBe('existing-session-token');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { message: 'Logged out successfully' } }),
    });

    const res = await client.logout();
    expect(res.message).toBe('Logged out successfully');
    expect(client.getAuthToken()).toBeNull();
  });

  it('fetches affected scope for an operational event and resolves directly to AffectedScopeResult', async () => {
    const mockEvent = {
      id: 'evt-1',
      type: 'REQUEST_CREATED',
      entityType: 'REQUEST',
      entityId: 'req-1',
      actorType: 'CITIZEN',
      occurredAt: '2026-11-10T06:00:00.000Z',
      recordedAt: '2026-11-10T06:00:01.000Z',
      payload: { peopleCount: 2 },
    };

    const mockScope = {
      eventId: 'evt-1',
      affectedRequestIds: ['req-1'],
      affectedResourceIds: ['res-1'],
      affectedProposedAssignmentIds: ['prop-1'],
      committedAssignmentsRequiringReview: ['assign-1'],
      reason: 'Critical request awaiting route assignment',
      repairEligible: true,
    };

    validateMockAgainstOpenApiSchema('OperationalEvent', mockEvent);
    validateMockAgainstOpenApiSchema('AffectedScopeResult', mockScope);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          event: mockEvent,
          affectedScope: mockScope,
        },
      }),
    });

    const res = await client.getAffectedScope('evt-1');
    expect(res.eventId).toBe('evt-1');
    expect(res.affectedRequestIds).toEqual(['req-1']);
    expect(res.affectedResourceIds).toEqual(['res-1']);
    expect(res.affectedProposedAssignmentIds).toEqual(['prop-1']);
    expect(res.committedAssignmentsRequiringReview).toEqual(['assign-1']);
    expect(res.reason).toBe('Critical request awaiting route assignment');
    expect(res.repairEligible).toBe(true);
  });

  it('throws ApiClientError when affectedScope is missing from getAffectedScope response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          event: { id: 'evt-1' },
          // affectedScope is missing
        },
      }),
    });

    await expect(client.getAffectedScope('evt-1')).rejects.toThrow(ApiClientError);
    await expect(client.getAffectedScope('evt-1')).rejects.toThrow(
      'Unexpected affected-scope response shape',
    );
  });

  it('throws ApiClientError when any required array in affectedScope is not an array', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          event: { id: 'evt-1' },
          affectedScope: {
            eventId: 'evt-1',
            affectedRequestIds: 'not-an-array',
            affectedResourceIds: [],
            affectedProposedAssignmentIds: [],
            committedAssignmentsRequiringReview: [],
            reason: 'Test',
            repairEligible: true,
          },
        },
      }),
    });

    await expect(client.getAffectedScope('evt-1')).rejects.toThrow(ApiClientError);
    await expect(client.getAffectedScope('evt-1')).rejects.toMatchObject({
      statusCode: 500,
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('maps HTTP 404 error envelope to ApiClientError with isNotFound true for getAffectedScope', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: {
          code: 'NOT_FOUND',
          message: 'Operational event not found',
        },
      }),
    });

    await expect(client.getAffectedScope('evt-nonexistent')).rejects.toThrow(ApiClientError);
    await expect(client.getAffectedScope('evt-nonexistent')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      isNotFound: true,
    });
  });

  it('fetches operational events with query filters matching OpenAPI contract', async () => {
    const mockEvent = {
      id: 'evt-op-1',
      type: 'REQUEST_CREATED',
      entityType: 'REQUEST',
      entityId: 'req-1',
      actorType: 'CITIZEN',
      occurredAt: '2026-11-09T10:00:00Z',
      recordedAt: '2026-11-09T10:00:01Z',
      payload: { urgency: 'CRITICAL', peopleCount: 3 },
    };
    validateMockAgainstOpenApiSchema('OperationalEvent', mockEvent);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        count: 1,
        data: [mockEvent],
      }),
    });

    const res = await client.getOperationalEvents({ status: 'RECORDED', limit: 10 });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('evt-op-1');

    const resList = await client.listOperationalEvents({ status: 'RECORDED', limit: 10 });
    expect(resList).toHaveLength(1);
    expect(resList[0].id).toBe('evt-op-1');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/operations/events?status=RECORDED&limit=10',
      expect.anything(),
    );
  });

  it('fetches a single operational event by ID matching OpenAPI contract', async () => {
    const mockEvent = {
      id: 'evt-op-2',
      type: 'RESOURCE_OFFLINE',
      entityType: 'RESOURCE',
      entityId: 'res-boat-1',
      actorType: 'OPERATOR',
      occurredAt: '2026-11-09T11:00:00Z',
      recordedAt: '2026-11-09T11:00:02Z',
      payload: { reason: 'Engine issue' },
    };
    validateMockAgainstOpenApiSchema('OperationalEvent', mockEvent);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockEvent,
      }),
    });

    const res = await client.getOperationalEvent('evt-op-2');
    expect(res.id).toBe('evt-op-2');
    expect(res.type).toBe('RESOURCE_OFFLINE');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/operations/events/evt-op-2',
      expect.anything(),
    );
  });

  it('updates resource status matching OpenAPI contract', async () => {
    const mockResource = {
      id: 'res-1',
      name: 'Boat Alpha',
      type: 'BOAT',
      capacity: 6,
      speedKmH: 25,
      lat: 28.69,
      lng: 77.23,
      status: 'OFFLINE',
    };
    validateMockAgainstOpenApiSchema('RescueResourceResponse', mockResource);

    const mockEvent = {
      id: 'evt-res-1',
      type: 'RESOURCE_OFFLINE',
      entityType: 'RESOURCE',
      entityId: 'res-1',
      actorType: 'OPERATOR',
      occurredAt: '2026-11-09T11:30:00Z',
      recordedAt: '2026-11-09T11:30:01Z',
      payload: { status: 'OFFLINE' },
    };
    validateMockAgainstOpenApiSchema('OperationalEvent', mockEvent);

    const mockScope = {
      eventId: 'evt-res-1',
      affectedRequestIds: [],
      affectedResourceIds: ['res-1'],
      affectedProposedAssignmentIds: [],
      committedAssignmentsRequiringReview: [],
      reason: 'Resource went offline',
      repairEligible: true,
    };
    validateMockAgainstOpenApiSchema('AffectedScopeResult', mockScope);

    const mockData = {
      resource: mockResource,
      event: mockEvent,
      affectedScope: mockScope,
    };
    validateMockAgainstOpenApiSchema('UpdateResourceStatusResponse.data', mockData);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockData,
      }),
    });

    const res = await client.updateResourceStatus('res-1', {
      status: 'OFFLINE',
      reason: 'Scheduled maintenance',
    });
    expect(res.resource.id).toBe('res-1');
    expect(res.resource.status).toBe('OFFLINE');
    expect(res.event?.id).toBe('evt-res-1');
    expect(res.affectedScope?.eventId).toBe('evt-res-1');
  });

  it('lists rescue resources matching OpenAPI contract', async () => {
    const mockResource = {
      id: 'res-1',
      name: 'Boat 1',
      type: 'BOAT',
      capacity: 6,
      speedKmH: 25,
      lat: 28.6139,
      lng: 77.209,
      status: 'AVAILABLE',
      source: 'REAL',
    };
    validateMockAgainstOpenApiSchema('RescueResourceResponse', mockResource);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        count: 1,
        data: [mockResource],
      }),
    });

    const res = await client.listResources({ status: 'AVAILABLE', type: 'BOAT' });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('res-1');
    expect(res[0].source).toBe('REAL');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/operations/resources?status=AVAILABLE&type=BOAT',
      expect.anything(),
    );
  });

  it('creates road zone matching OpenAPI contract', async () => {
    const mockZone = {
      id: 'bz-1',
      name: 'Flooded Underpass',
      severity: 'BLOCKED',
      polygon: [
        { lat: 28.691, lng: 77.231 },
        { lat: 28.692, lng: 77.232 },
        { lat: 28.693, lng: 77.233 },
      ],
      isActive: true,
      createdBy: 'eoc_operator',
    };
    validateMockAgainstOpenApiSchema('BlockedZoneResponse', mockZone);

    const mockEvent = {
      id: 'evt-zone-1',
      type: 'ROAD_BLOCKED',
      entityType: 'ROAD_ZONE',
      entityId: 'bz-1',
      actorType: 'OPERATOR',
      occurredAt: '2026-11-09T12:00:00Z',
      recordedAt: '2026-11-09T12:00:01Z',
      payload: { zoneId: 'bz-1' },
    };
    validateMockAgainstOpenApiSchema('OperationalEvent', mockEvent);

    const mockScope = {
      eventId: 'evt-zone-1',
      affectedRequestIds: [],
      affectedResourceIds: [],
      affectedProposedAssignmentIds: [],
      committedAssignmentsRequiringReview: [],
      reason: 'Road blocked',
      repairEligible: false,
    };
    validateMockAgainstOpenApiSchema('AffectedScopeResult', mockScope);

    const mockData = {
      zone: mockZone,
      event: mockEvent,
      affectedScope: mockScope,
    };
    validateMockAgainstOpenApiSchema('RoadZoneResponse.data', mockData);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        data: mockData,
      }),
    });

    const res = await client.createRoadZone({
      name: 'Flooded Underpass',
      severity: 'BLOCKED',
      polygon: [
        { lat: 28.691, lng: 77.231 },
        { lat: 28.692, lng: 77.232 },
        { lat: 28.693, lng: 77.233 },
      ],
    });
    expect(res.zone?.id).toBe('bz-1');
    expect(res.event.id).toBe('evt-zone-1');
    expect(res.affectedScope.eventId).toBe('evt-zone-1');
  });

  it('reopens road zone matching OpenAPI contract', async () => {
    const mockZone = {
      id: 'bz-1',
      name: 'Flooded Underpass',
      severity: 'BLOCKED',
      polygon: [
        { lat: 28.691, lng: 77.231 },
        { lat: 28.692, lng: 77.232 },
        { lat: 28.693, lng: 77.233 },
      ],
      isActive: false,
      createdBy: 'eoc_operator',
    };
    validateMockAgainstOpenApiSchema('BlockedZoneResponse', mockZone);

    const mockEvent = {
      id: 'evt-reopen-1',
      type: 'ROAD_REOPENED',
      entityType: 'ROAD_ZONE',
      entityId: 'bz-1',
      actorType: 'OPERATOR',
      occurredAt: '2026-11-09T13:00:00Z',
      recordedAt: '2026-11-09T13:00:01Z',
      payload: { zoneId: 'bz-1' },
    };
    validateMockAgainstOpenApiSchema('OperationalEvent', mockEvent);

    const mockScope = {
      eventId: 'evt-reopen-1',
      affectedRequestIds: [],
      affectedResourceIds: [],
      affectedProposedAssignmentIds: [],
      committedAssignmentsRequiringReview: [],
      reason: 'Road reopened',
      repairEligible: false,
    };
    validateMockAgainstOpenApiSchema('AffectedScopeResult', mockScope);

    const mockData = {
      zone: mockZone,
      event: mockEvent,
      affectedScope: mockScope,
    };
    validateMockAgainstOpenApiSchema('RoadZoneResponse.data', mockData);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockData,
      }),
    });

    const res = await client.reopenRoadZone('bz-1');
    expect(res.zone?.id).toBe('bz-1');
    expect(res.event.id).toBe('evt-reopen-1');
  });

  it('requests plan repair proposal matching OpenAPI contract', async () => {
    const mockRepairResult = {
      status: 'PROPOSED' as const,
      unservedRequestIds: ['req-9'],
      warnings: ['Resource capacity constrained'],
      proposalId: 'prop-repair-1',
    };
    validateMockAgainstOpenApiSchema('RepairResultResponse.data', mockRepairResult);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockRepairResult,
      }),
    });

    const res = await client.requestRepair({ eventId: 'evt-1' });
    expect(res.status).toBe('PROPOSED');
    expect(res.unservedRequestIds).toEqual(['req-9']);
    expect(res.warnings).toEqual(['Resource capacity constrained']);
  });
});
