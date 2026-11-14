import { z } from 'zod';

export const ListOperationalEventsFilterSchema = z.object({
  eventType: z
    .enum([
      'REQUEST_CREATED',
      'REQUEST_FLAGGED_DUPLICATE',
      'REQUEST_CANCELLED',
      'RESOURCE_OFFLINE',
      'RESOURCE_AVAILABLE',
      'ROAD_BLOCKED',
      'ROAD_REOPENED',
    ])
    .optional(),
  entityType: z.enum(['REQUEST', 'RESOURCE', 'ROAD_ZONE', 'ASSIGNMENT']).optional(),
  entityId: z.string().optional(),
  actorType: z.enum(['CITIZEN', 'OPERATOR', 'SYSTEM']).optional(),
  actorId: z.string().optional(),
  processingStatus: z
    .enum(['RECORDED', 'SCOPE_IDENTIFIED', 'AWAITING_REPAIR', 'FAILED'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const ListAuditEventsFilterSchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  eventType: z.string().optional(),
  actor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const ListResourcesFilterSchema = z.object({
  status: z.enum(['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE', 'OFFLINE']).optional(),
  type: z.enum(['BOAT', 'HIGH_WATER_VEHICLE', 'AMBULANCE', 'HELICOPTER']).optional(),
});

export const UpdateResourceStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE', 'OFFLINE']),
  reason: z.string().max(256).optional(),
});

export const CreateRoadZoneSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  severity: z.enum(['BLOCKED', 'WATER_SURGE', 'CAUTION']).default('BLOCKED'),
  polygon: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }),
    )
    .min(3, 'A polygon requires at least 3 coordinate points'),
  reason: z.string().max(256).optional(),
});

export const RequestRepairSchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  baselineAssignmentId: z.string().optional(),
  expectedVersion: z.number().int().min(1).optional(),
});
