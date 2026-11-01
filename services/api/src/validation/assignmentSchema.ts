import { z } from 'zod';

export const ASSUMED_MAX_HAZARD_ZONES = 100; // placeholder, not measured
export const ASSUMED_MAX_VERTICES_PER_POLYGON = 200; // placeholder, not measured
export const ASSUMED_MAX_TOTAL_VERTICES_PER_REQUEST = 2000; // placeholder, not measured

export const BlockedZoneInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  severity: z.enum(['BLOCKED', 'WATER_SURGE', 'CAUTION']),
  polygon: z
    .array(
      z.object({
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
      }),
    )
    .min(3)
    .max(ASSUMED_MAX_VERTICES_PER_POLYGON)
    .refine(
      (pts) => {
        const distinct = new Set(pts.map((p) => `${p.lat},${p.lng}`));
        return distinct.size >= 3;
      },
      { message: 'Polygon ring must contain at least 3 distinct vertices' },
    ),
});

export type BlockedZoneInput = z.infer<typeof BlockedZoneInputSchema>;

export const ProposeAssignmentSchema = z.object({
  scenarioId: z.string().min(1).optional().default('scenario-delhi-yamuna-demo'),
  algorithm: z
    .enum(['cluster-allocation', 'nearest-first', 'savings'])
    .optional()
    .default('cluster-allocation'),
  includeUnverified: z.boolean().optional().default(false),
  preserveFrozen: z.boolean().optional().default(true),
  maxShiftMinutes: z.number().int().positive().max(1440).optional().default(480),
  blockedZones: z
    .array(BlockedZoneInputSchema)
    .max(ASSUMED_MAX_HAZARD_ZONES)
    .refine(
      (zones) => {
        if (!zones) return true;
        const total = zones.reduce((sum, z) => sum + z.polygon.length, 0);
        return total <= ASSUMED_MAX_TOTAL_VERTICES_PER_REQUEST;
      },
      {
        message: `Total polygon vertices across all blocked zones cannot exceed ${ASSUMED_MAX_TOTAL_VERTICES_PER_REQUEST}`,
      },
    )
    .optional(),
});

export type ProposeAssignmentInput = z.infer<typeof ProposeAssignmentSchema>;

export const CommitAssignmentSchema = z.object({
  operatorId: z
    .string({
      message: 'operatorId is required to commit an assignment',
    })
    .min(1, 'operatorId cannot be empty'),
  notes: z.string().max(1000).optional(),
});

export type CommitAssignmentInput = z.infer<typeof CommitAssignmentSchema>;

export const ModifyStopSchema = z
  .object({
    isFrozen: z.boolean().optional(),
    stopNumber: z.number().int().positive().optional(),
    resourceId: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      data.isFrozen !== undefined || data.stopNumber !== undefined || data.resourceId !== undefined,
    {
      message: 'At least one field (isFrozen, stopNumber, or resourceId) must be provided',
    },
  );

export type ModifyStopInput = z.infer<typeof ModifyStopSchema>;

export const ListAssignmentsFilterSchema = z.object({
  status: z.enum(['PROPOSED', 'COMMITTED']).optional(),
  scenarioId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListAssignmentsFilter = z.infer<typeof ListAssignmentsFilterSchema>;
