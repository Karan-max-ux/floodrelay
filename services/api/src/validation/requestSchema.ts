import { z } from 'zod';

export const UrgencyLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const RequestSourceSchema = z.enum(['SIMULATED', 'REPORTED']);
export const RequestStatusSchema = z.enum([
  'PENDING',
  'ASSIGNED',
  'IN_TRANSIT',
  'RESCUED',
  'CANCELLED',
]);
export const VerificationStatusSchema = z.enum(['UNVERIFIED', 'VERIFIED', 'REJECTED']);

export const CreateRequestSchema = z.object({
  lat: z
    .number({ message: 'Latitude is required' })
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  lng: z
    .number({ message: 'Longitude is required' })
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  peopleCount: z
    .number({ message: 'peopleCount is required' })
    .int('peopleCount must be an integer')
    .positive('peopleCount must be greater than zero'),
  urgency: UrgencyLevelSchema,
  medicalNeeds: z.boolean().optional().default(false),
  notes: z.string().max(1000, 'Notes cannot exceed 1000 characters').optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1, 'idempotencyKey cannot be empty')
    .max(128, 'idempotencyKey cannot exceed 128 characters')
    .optional(),
  source: RequestSourceSchema.optional().default('REPORTED'),
  verificationStatus: VerificationStatusSchema.optional().default('UNVERIFIED'),
});

export type CreateRequestInput = z.infer<typeof CreateRequestSchema>;

export const ListRequestsFilterSchema = z.object({
  status: RequestStatusSchema.optional(),
  urgency: UrgencyLevelSchema.optional(),
  source: RequestSourceSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional().default(50),
  offset: z.coerce.number().int().nonnegative().max(10000, "Offset cannot exceed 10000").optional().default(0),
});

export type ListRequestsFilter = z.infer<typeof ListRequestsFilterSchema>;
