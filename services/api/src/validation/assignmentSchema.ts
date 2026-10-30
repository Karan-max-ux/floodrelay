import { z } from 'zod';

export const ProposeAssignmentSchema = z.object({
  scenarioId: z.string().min(1).optional().default('scenario-delhi-yamuna-demo'),
  algorithm: z
    .enum(['cluster-allocation', 'nearest-first', 'savings'])
    .optional()
    .default('cluster-allocation'),
  includeUnverified: z.boolean().optional().default(false),
  preserveFrozen: z.boolean().optional().default(true),
  maxShiftMinutes: z.number().int().positive().max(1440).optional().default(480),
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
