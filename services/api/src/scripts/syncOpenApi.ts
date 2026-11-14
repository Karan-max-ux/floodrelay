import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiSpecPath = path.resolve(__dirname, '../openapi.json');
const docsSpecPath = path.resolve(__dirname, '../../../../docs/openapi.json');

const spec = JSON.parse(fs.readFileSync(apiSpecPath, 'utf-8'));

// 1. Add security schemes
spec.components = spec.components || {};
spec.components.securitySchemes = {
  BearerAuth: {
    type: 'http',
    scheme: 'bearer',
    description: 'Operator cryptographic session token issued by POST /auth/login',
  },
  CookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: 'floodrelay_session',
    description: 'HTTP-only session cookie set by POST /auth/login',
  },
};

// 2. Add schemas
spec.components.schemas = spec.components.schemas || {};

spec.components.schemas.OperatorProfile = {
  type: 'object',
  required: ['id', 'username', 'name', 'role'],
  properties: {
    id: { type: 'string', example: 'op-8a7f9b1c' },
    username: { type: 'string', example: 'eoc_operator' },
    name: { type: 'string', example: 'Capt. R. Vance' },
    role: { type: 'string', enum: ['OPERATOR', 'ADMIN', 'DISPATCHER'], example: 'OPERATOR' },
  },
};

spec.components.schemas.LoginInput = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', example: 'eoc_operator' },
    password: { type: 'string', format: 'password', example: 'YourSecurePassword123!' },
  },
};

spec.components.schemas.LoginResponse = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {
      type: 'object',
      required: ['token', 'operator', 'expiresAt'],
      properties: {
        token: { type: 'string', example: '8f4c2e687a19c5b290df62e8412bc481' },
        operator: { $ref: '#/components/schemas/OperatorProfile' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  },
};

spec.components.schemas.LogoutResponse = {
  type: 'object',
  required: ['success', 'message', 'timestamp'],
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Logged out successfully' },
    timestamp: { type: 'string', format: 'date-time' },
  },
};

spec.components.schemas.MeResponse = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {
      type: 'object',
      required: ['operator'],
      properties: {
        operator: { $ref: '#/components/schemas/OperatorProfile' },
      },
    },
  },
};

// Phase 5 Schemas: Operational Events, RBAC & Repair
spec.components.schemas.GeoPoint = {
  type: 'object',
  required: ['lat', 'lng'],
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90, example: 28.6139 },
    lng: { type: 'number', minimum: -180, maximum: 180, example: 77.209 },
  },
};

spec.components.schemas.RescueResourceResponse = {
  type: 'object',
  required: ['id', 'name', 'type', 'capacity', 'speedKmH', 'lat', 'lng', 'status'],
  properties: {
    id: { type: 'string', example: 'res-boat-1' },
    name: { type: 'string', example: 'Rescue Boat Alpha' },
    type: {
      type: 'string',
      enum: ['BOAT', 'HIGH_WATER_VEHICLE', 'AMBULANCE', 'HELICOPTER'],
      example: 'BOAT',
    },
    capacity: { type: 'integer', example: 6 },
    speedKmH: { type: 'number', example: 25.0 },
    lat: { type: 'number', example: 28.6139 },
    lng: { type: 'number', example: 77.209 },
    status: {
      type: 'string',
      enum: ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE', 'OFFLINE'],
      example: 'OFFLINE',
    },
    depotId: { type: 'string', example: 'shelter-north-1', nullable: true },
    source: { type: 'string', enum: ['SIMULATED', 'REAL'], example: 'REAL', nullable: true },
  },
};

spec.components.schemas.SolverPlan = {
  type: 'object',
  required: ['scenarioId', 'calculatedAt', 'routes', 'unserved', 'metrics'],
  properties: {
    scenarioId: { type: 'string', example: 'scenario-delhi-monsoon' },
    calculatedAt: { type: 'string', format: 'date-time' },
    solverStatus: { type: 'string', example: 'FEASIBLE_LOCAL_OPTIMUM' },
    routes: {
      type: 'array',
      items: { $ref: '#/components/schemas/ResourceRoute' },
    },
    unserved: {
      type: 'array',
      items: { $ref: '#/components/schemas/UnservedRequest' },
    },
    metrics: { $ref: '#/components/schemas/SolverMetrics' },
  },
};

spec.components.schemas.OperationalEvent = {
  type: 'object',
  required: [
    'id',
    'type',
    'entityType',
    'entityId',
    'actorType',
    'occurredAt',
    'recordedAt',
    'payload',
  ],
  properties: {
    id: { type: 'string', example: 'evt-4a8b1c2d' },
    type: {
      type: 'string',
      enum: [
        'REQUEST_CREATED',
        'REQUEST_FLAGGED_DUPLICATE',
        'REQUEST_CANCELLED',
        'RESOURCE_OFFLINE',
        'RESOURCE_AVAILABLE',
        'ROAD_BLOCKED',
        'ROAD_REOPENED',
      ],
      example: 'REQUEST_CREATED',
    },
    entityType: {
      type: 'string',
      enum: ['REQUEST', 'RESOURCE', 'ROAD_ZONE', 'ASSIGNMENT'],
      example: 'REQUEST',
    },
    entityId: { type: 'string', example: 'req-3f8a1b2c' },
    actorId: { type: 'string', nullable: true, example: 'eoc_operator' },
    actorType: {
      type: 'string',
      enum: ['CITIZEN', 'OPERATOR', 'SYSTEM'],
      example: 'CITIZEN',
    },
    occurredAt: { type: 'string', format: 'date-time' },
    recordedAt: { type: 'string', format: 'date-time' },
    correlationId: { type: 'string', nullable: true },
    idempotencyKey: { type: 'string', nullable: true },
    entityVersion: { type: 'integer', example: 1 },
    processingStatus: {
      type: 'string',
      enum: ['RECORDED', 'SCOPE_IDENTIFIED', 'AWAITING_REPAIR', 'FAILED'],
      example: 'RECORDED',
    },
    processingAttempts: { type: 'integer', example: 0 },
    lastErrorCode: { type: 'string', nullable: true },
    processedAt: { type: 'string', format: 'date-time', nullable: true },
    payload: { type: 'object', additionalProperties: true },
  },
};

spec.components.schemas.OperationalEventListResponse = {
  type: 'object',
  required: ['success', 'count', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    count: { type: 'integer', example: 1 },
    data: {
      type: 'array',
      items: { $ref: '#/components/schemas/OperationalEvent' },
    },
  },
};

spec.components.schemas.OperationalEventDetailResponse = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: { $ref: '#/components/schemas/OperationalEvent' },
  },
};

spec.components.schemas.ListResourcesResponse = {
  type: 'object',
  required: ['success', 'count', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    count: { type: 'integer', example: 1 },
    data: {
      type: 'array',
      items: { $ref: '#/components/schemas/RescueResourceResponse' },
    },
  },
};

spec.components.schemas.AffectedScopeResult = {
  type: 'object',
  required: [
    'eventId',
    'affectedRequestIds',
    'affectedResourceIds',
    'affectedProposedAssignmentIds',
    'committedAssignmentsRequiringReview',
    'reason',
    'repairEligible',
  ],
  properties: {
    eventId: { type: 'string', example: 'evt-4a8b1c2d' },
    affectedRequestIds: {
      type: 'array',
      items: { type: 'string' },
      example: ['req-3f8a1b2c'],
    },
    affectedResourceIds: {
      type: 'array',
      items: { type: 'string' },
      example: ['res-boat-1'],
    },
    affectedProposedAssignmentIds: {
      type: 'array',
      items: { type: 'string' },
      example: ['assign-7d2a1b'],
    },
    committedAssignmentsRequiringReview: {
      type: 'array',
      items: { type: 'string' },
      example: [],
    },
    reason: { type: 'string', example: 'New rescue request recorded' },
    repairEligible: { type: 'boolean', example: true },
  },
};

spec.components.schemas.AffectedScopeResponse = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {
      type: 'object',
      required: ['event', 'affectedScope'],
      properties: {
        event: { $ref: '#/components/schemas/OperationalEvent' },
        affectedScope: { $ref: '#/components/schemas/AffectedScopeResult' },
      },
    },
  },
};

spec.components.schemas.UpdateResourceStatusInput = {
  type: 'object',
  required: ['status'],
  properties: {
    status: {
      type: 'string',
      enum: ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE', 'OFFLINE'],
      example: 'OFFLINE',
    },
    reason: { type: 'string', example: 'Engine maintenance required' },
  },
};

spec.components.schemas.UpdateResourceStatusResponse = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {
      type: 'object',
      required: ['resource'],
      properties: {
        resource: { $ref: '#/components/schemas/RescueResourceResponse' },
        event: { $ref: '#/components/schemas/OperationalEvent', nullable: true },
        affectedScope: { $ref: '#/components/schemas/AffectedScopeResult', nullable: true },
      },
    },
  },
};

spec.components.schemas.CreateRoadZoneInput = {
  type: 'object',
  required: ['polygon'],
  properties: {
    name: { type: 'string', example: 'Yamuna Flood Hazard Area' },
    severity: {
      type: 'string',
      enum: ['BLOCKED', 'WATER_SURGE', 'CAUTION'],
      default: 'BLOCKED',
      example: 'BLOCKED',
    },
    polygon: {
      type: 'array',
      items: { $ref: '#/components/schemas/GeoPoint' },
      minItems: 3,
    },
    reason: { type: 'string', example: 'Road submerged under 1.5m flood water' },
  },
};

spec.components.schemas.BlockedZoneResponse = {
  type: 'object',
  required: ['id', 'severity', 'polygon', 'isActive', 'createdBy'],
  properties: {
    id: { type: 'string', example: 'bz-5c3a2f' },
    name: { type: 'string', example: 'Yamuna Flood Hazard Area', nullable: true },
    severity: {
      type: 'string',
      enum: ['BLOCKED', 'WATER_SURGE', 'CAUTION'],
      example: 'BLOCKED',
    },
    polygon: {
      type: 'array',
      items: { $ref: '#/components/schemas/GeoPoint' },
    },
    isActive: { type: 'boolean', example: true },
    createdBy: { type: 'string', example: 'eoc_operator' },
  },
};

spec.components.schemas.RoadZoneResponse = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {
      type: 'object',
      required: ['zone', 'event'],
      properties: {
        zone: { $ref: '#/components/schemas/BlockedZoneResponse', nullable: true },
        event: { $ref: '#/components/schemas/OperationalEvent' },
        affectedScope: { $ref: '#/components/schemas/AffectedScopeResult', nullable: true },
      },
    },
  },
};

spec.components.schemas.RequestRepairInput = {
  type: 'object',
  required: ['eventId'],
  properties: {
    eventId: { type: 'string', example: 'evt-4a8b1c2d' },
    baselineAssignmentId: { type: 'string', example: 'assign-7d2a1b', nullable: true },
    expectedVersion: { type: 'integer', example: 1, nullable: true },
  },
};

spec.components.schemas.RepairResultResponse = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {
      type: 'object',
      required: ['status', 'unservedRequestIds', 'warnings'],
      properties: {
        status: { type: 'string', enum: ['PROPOSED', 'NO_FEASIBLE_REPAIR'], example: 'PROPOSED' },
        proposedPlan: { $ref: '#/components/schemas/SolverPlan', nullable: true },
        unservedRequestIds: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
        baselineVersion: { type: 'integer', nullable: true },
      },
    },
  },
};

spec.components.schemas.AuditEvent = {
  type: 'object',
  required: ['id', 'entity_type', 'entity_id', 'event_type', 'actor', 'payload', 'created_at'],
  properties: {
    id: { type: 'string', example: '1' },
    entity_type: { type: 'string', example: 'REQUEST' },
    entity_id: { type: 'string', example: 'req-3f8a1b2c' },
    event_type: { type: 'string', example: 'REQUEST_CREATED' },
    actor: { type: 'string', example: 'CITIZEN' },
    payload: { type: 'object', additionalProperties: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

spec.components.schemas.AuditEventListResponse = {
  type: 'object',
  required: ['success', 'count', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    count: { type: 'integer', example: 1 },
    data: {
      type: 'array',
      items: { $ref: '#/components/schemas/AuditEvent' },
    },
  },
};

spec.components.schemas.CancelRequestResponse = {
  type: 'object',
  required: ['success', 'message', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Rescue request cancelled successfully' },
    data: { $ref: '#/components/schemas/RescueRequestResponse' },
  },
};

// 3. Add paths
spec.paths = spec.paths || {};

spec.paths['/auth/login'] = {
  post: {
    summary: 'Authenticate operator',
    description:
      'Verifies operator credentials, enforces rate limiting, and issues a cryptographic session token and HTTP-only cookie.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/LoginInput' },
        },
      },
    },
    responses: {
      '200': {
        description: 'Login successful',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginResponse' },
          },
        },
      },
      '400': {
        description: 'Validation failure',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '401': {
        description: 'Invalid credentials',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '429': {
        description: 'Rate limit exceeded',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/auth/logout'] = {
  post: {
    summary: 'Log out operator',
    description: 'Revokes active operator session and clears the session cookie.',
    responses: {
      '200': {
        description: 'Logged out successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LogoutResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/auth/me'] = {
  get: {
    summary: 'Get current operator session profile',
    description: 'Returns profile of currently authenticated operator.',
    security: [{ BearerAuth: [] }, { CookieAuth: [] }],
    responses: {
      '200': {
        description: 'Active operator session profile',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MeResponse' },
          },
        },
      },
      '401': {
        description: 'Unauthorized or session expired',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/requests/{id}/cancel'] = {
  post: {
    summary: 'Cancel rescue request',
    description:
      'Cancels an unassigned or pending rescue request and emits REQUEST_CANCELLED. Requires either operator authentication or matching idempotencyKey proof of ownership. Rejects with 409 if request is committed to an active mission.',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Rescue request ID to cancel',
      },
    ],
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              reason: { type: 'string', example: 'Water receded, no longer in danger' },
              idempotencyKey: {
                type: 'string',
                description:
                  'Original idempotency key submitted by citizen as proof of ownership when cancelling without operator auth',
                example: 'idem-12345',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Rescue request cancelled successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CancelRequestResponse' },
          },
        },
      },
      '400': {
        description: 'Validation failure',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '401': {
        description: 'Unauthorized: missing operator authentication or idempotency key',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '403': {
        description: 'Forbidden: idempotency key does not match request',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '404': {
        description: 'Rescue request not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '409': {
        description: 'Cannot cancel request tied to committed assignment',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/operations/events'] = {
  get: {
    summary: 'List operational events',
    description:
      'Retrieves paginated, filtered log of operational lifecycle events. Requires VIEW_EVENTS permission.',
    parameters: [
      { name: 'eventType', in: 'query', schema: { type: 'string' } },
      { name: 'entityType', in: 'query', schema: { type: 'string' } },
      { name: 'entityId', in: 'query', schema: { type: 'string' } },
      { name: 'actorType', in: 'query', schema: { type: 'string' } },
      { name: 'actorId', in: 'query', schema: { type: 'string' } },
      { name: 'processingStatus', in: 'query', schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
      { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
    ],
    responses: {
      '200': {
        description: 'List of operational events',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/OperationalEventListResponse' },
          },
        },
      },
      '400': {
        description: 'Validation failure on query filters',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/operations/events/{id}'] = {
  get: {
    summary: 'Get operational event by ID',
    description: 'Retrieves a single operational event. Requires VIEW_EVENTS permission.',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'Operational event detail',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/OperationalEventDetailResponse' },
          },
        },
      },
      '404': {
        description: 'Event not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/operations/events/{id}/affected-scope'] = {
  get: {
    summary: 'Evaluate planning scope affected by event',
    description:
      'Computes candidate requests, resources, and mutable proposals without mutating assignments. Requires VIEW_EVENTS permission.',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'Evaluated affected planning scope',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AffectedScopeResponse' },
          },
        },
      },
      '404': {
        description: 'Event not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/operations/resources'] = {
  get: {
    summary: 'List operational rescue resources',
    description:
      'Retrieves list of registered rescue resources with optional status and type filters. Accessible to all authenticated operator roles.',
    parameters: [
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE', 'OFFLINE'],
        },
        description: 'Filter resources by operational status',
      },
      {
        name: 'type',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: ['BOAT', 'HIGH_WATER_VEHICLE', 'AMBULANCE', 'HELICOPTER'],
        },
        description: 'Filter resources by vehicle type',
      },
    ],
    responses: {
      '200': {
        description: 'List of resources retrieved successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ListResourcesResponse' },
          },
        },
      },
      '400': {
        description: 'Validation failure on filter query parameters',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/operations/resources/{id}/status'] = {
  patch: {
    summary: 'Update resource operational status',
    description:
      'Changes status of a rescue resource, emits RESOURCE_OFFLINE or RESOURCE_AVAILABLE, and evaluates affected scope. Requires MANAGE_RESOURCE_STATUS permission.',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateResourceStatusInput' },
        },
      },
    },
    responses: {
      '200': {
        description: 'Resource status updated successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateResourceStatusResponse' },
          },
        },
      },
      '400': {
        description: 'Validation failure',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '404': {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/operations/road-zones'] = {
  post: {
    summary: 'Record operator-managed hazard or road closure',
    description:
      'Creates a persistent blocked zone, emits ROAD_BLOCKED event, and evaluates affected scope. Requires MANAGE_BLOCKED_ZONES permission.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateRoadZoneInput' },
        },
      },
    },
    responses: {
      '201': {
        description: 'Hazard zone created and event emitted',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RoadZoneResponse' },
          },
        },
      },
      '400': {
        description: 'Validation failure',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/operations/road-zones/{id}'] = {
  delete: {
    summary: 'Reopen blocked road zone',
    description:
      'Deactivates a hazard zone, emits ROAD_REOPENED event, and evaluates affected scope. Requires MANAGE_BLOCKED_ZONES permission.',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'Hazard zone deactivated and event emitted',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RoadZoneResponse' },
          },
        },
      },
      '404': {
        description: 'Blocked zone not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/operations/repair'] = {
  post: {
    summary: 'Request incremental plan repair proposal',
    description:
      'Orchestrates incremental plan repair from an operational event. Returns 503 REPAIR_ENGINE_UNAVAILABLE in Phase 5 Part 1. Requires REQUEST_REPAIR permission.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/RequestRepairInput' },
        },
      },
    },
    responses: {
      '200': {
        description: 'Plan repair proposal result',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RepairResultResponse' },
          },
        },
      },
      '400': {
        description: 'Validation failure',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '404': {
        description: 'Event not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      '503': {
        description: 'Repair engine unavailable',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

spec.paths['/audit/events'] = {
  get: {
    summary: 'Query system audit event log',
    description:
      'Returns paginated audit records with role-based redaction of sensitive metadata. Requires VIEW_AUDIT permission.',
    parameters: [
      { name: 'entityType', in: 'query', schema: { type: 'string' } },
      { name: 'entityId', in: 'query', schema: { type: 'string' } },
      { name: 'eventType', in: 'query', schema: { type: 'string' } },
      { name: 'actor', in: 'query', schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
      { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
    ],
    responses: {
      '200': {
        description: 'Audit events log',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AuditEventListResponse' },
          },
        },
      },
      '400': {
        description: 'Validation failure on query filters',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
  },
};

// 4. Annotate protected routes with security & 401 response
const protectedRoutes: Array<{ path: string; method: string }> = [
  { path: '/requests', method: 'get' },
  { path: '/requests/{id}', method: 'get' },
  { path: '/assignments', method: 'get' },
  { path: '/assignments/propose', method: 'post' },
  { path: '/assignments/{id}', method: 'get' },
  { path: '/assignments/{id}/commit', method: 'post' },
  { path: '/assignments/{id}/stops/{stopId}', method: 'patch' },
  { path: '/operations/events', method: 'get' },
  { path: '/operations/events/{id}', method: 'get' },
  { path: '/operations/events/{id}/affected-scope', method: 'get' },
  { path: '/operations/resources', method: 'get' },
  { path: '/operations/resources/{id}/status', method: 'patch' },
  { path: '/operations/road-zones', method: 'post' },
  { path: '/operations/road-zones/{id}', method: 'delete' },
  { path: '/operations/repair', method: 'post' },
  { path: '/audit/events', method: 'get' },
];

for (const pr of protectedRoutes) {
  if (spec.paths[pr.path] && spec.paths[pr.path][pr.method]) {
    spec.paths[pr.path][pr.method].security = [{ BearerAuth: [] }, { CookieAuth: [] }];
    if (!spec.paths[pr.path][pr.method].responses['401']) {
      spec.paths[pr.path][pr.method].responses['401'] = {
        description: 'Operator authentication required or session expired',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      };
    }
  }
}

// Ensure key sorting is stable
const sortedPaths: Record<string, unknown> = {};
for (const p of Object.keys(spec.paths).sort()) {
  sortedPaths[p] = spec.paths[p];
}
spec.paths = sortedPaths;

const formattedJson = JSON.stringify(spec, null, 2) + '\n';

fs.writeFileSync(apiSpecPath, formattedJson, 'utf-8');
fs.writeFileSync(docsSpecPath, formattedJson, 'utf-8');

console.log(
  '✓ Synchronized OpenAPI specification in services/api/src/openapi.json and docs/openapi.json',
);
