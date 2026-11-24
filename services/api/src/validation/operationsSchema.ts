import { z } from 'zod';
import { isValidCatalogModel } from '@floodrelay/shared';

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
  source: z.enum(['SIMULATED', 'REAL']).optional(),
  search: z.string().max(100).optional(),
});

export const UpdateResourceStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'OFFLINE']),
  reason: z.string().max(256).optional(),
});

export const RegisterResourceSchema = z.object({
  modelId: z.string().refine(isValidCatalogModel, {
    message: 'Invalid vehicle model catalog selection',
  }),
  name: z.string().trim().min(1).max(128).optional(),
  id: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Custom ID must contain only letters, numbers, hyphens, and underscores',
    )
    .min(3, 'Custom ID must be at least 3 characters')
    .max(64, 'Custom ID cannot exceed 64 characters')
    .optional(),
  capacity: z.coerce
    .number()
    .int()
    .min(1, 'Capacity must be at least 1 passenger')
    .max(1000, 'Capacity cannot exceed 1000 passengers')
    .optional(),
  speedKmH: z.coerce
    .number()
    .positive('Speed must be positive')
    .max(300, 'Speed cannot exceed 300 km/h')
    .optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  depotId: z.string().trim().max(64).nullable().optional(),
  status: z.enum(['OFFLINE', 'MAINTENANCE']).default('OFFLINE'),
  notes: z.string().trim().max(500, 'Notes cannot exceed 500 characters').nullable().optional(),
});

export const UpdateResourceDetailsSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    modelId: z
      .string()
      .refine(isValidCatalogModel, {
        message: 'Invalid vehicle model catalog selection',
      })
      .optional(),
    capacity: z.coerce
      .number()
      .int()
      .min(1, 'Capacity must be at least 1 passenger')
      .max(100, 'Capacity cannot exceed 100 passengers')
      .optional(),
    speedKmH: z.coerce
      .number()
      .positive('Speed must be positive')
      .max(300, 'Speed cannot exceed 300 km/h')
      .optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    depotId: z.string().trim().max(64).nullable().optional(),
    notes: z.string().trim().max(500, 'Notes cannot exceed 500 characters').nullable().optional(),
    expectedVersion: z.coerce.number().int().min(1).optional(),
  })
  .refine(
    (data) =>
      (data.lat === undefined && data.lng === undefined) ||
      (data.lat !== undefined && data.lng !== undefined),
    { message: 'Both lat and lng must be provided together when updating coordinates' },
  );

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
