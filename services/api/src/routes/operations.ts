import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import type { PostgisRepository } from '../db/repository.js';
import type { OperationalEventService } from '../services/operationalEventService.js';
import type { RepairOrchestrationService } from '../services/repairOrchestrationService.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import {
  ListOperationalEventsFilterSchema,
  ListResourcesFilterSchema,
  UpdateResourceStatusSchema,
  RegisterResourceSchema,
  UpdateResourceDetailsSchema,
  CreateRoadZoneSchema,
  RequestRepairSchema,
} from '../validation/operationsSchema.js';
import { dbToBlockedZone } from '../db/schema.js';
import { APPROVED_VEHICLE_CATALOG, getVehicleCatalogModel } from '@floodrelay/shared';
import { ServiceAreaService } from '../services/serviceAreaService.js';

export function createOperationsRouter(
  repo: PostgisRepository,
  eventService: OperationalEventService,
  repairService: RepairOrchestrationService,
  serviceAreaService?: ServiceAreaService,
): Router {
  const router = Router();
  const areaService = serviceAreaService ?? new ServiceAreaService(repo);

  // GET /operations/events - List operational events (RBAC: VIEW_EVENTS)
  router.get(
    '/events',
    requirePermission('VIEW_EVENTS'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = ListOperationalEventsFilterSchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid query filters for operational events',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const events = await eventService.listEvents(parsed.data);
        res.status(200).json({
          success: true,
          count: events.length,
          data: events,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /operations/events/:id - Get specific event (RBAC: VIEW_EVENTS)
  router.get(
    '/events/:id',
    requirePermission('VIEW_EVENTS'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Event ID parameter is required',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const event = await eventService.getEvent(id);
        if (!event) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: `Operational event with id "${id}" not found`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        res.status(200).json({
          success: true,
          data: event,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /operations/events/:id/affected-scope - Evaluate affected scope (RBAC: VIEW_EVENTS)
  router.get(
    '/events/:id/affected-scope',
    requirePermission('VIEW_EVENTS'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Event ID parameter is required',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const result = await eventService.processEvent(id);
        res.status(200).json({
          success: true,
          data: result,
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (code && statusCode) {
          res.status(statusCode).json({
            error: {
              code,
              message: (err as Error).message,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }
        next(err);
      }
    },
  );

  // GET /operations/vehicle-models - List approved vehicle catalog options (RBAC: VIEW_EVENTS)
  router.get(
    '/vehicle-models',
    requirePermission('VIEW_EVENTS'),
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        res.status(200).json({
          success: true,
          count: APPROVED_VEHICLE_CATALOG.length,
          data: APPROVED_VEHICLE_CATALOG,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /operations/resources - List operational resources (RBAC: VIEW_EVENTS)
  router.get(
    '/resources',
    requirePermission('VIEW_EVENTS'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = ListResourcesFilterSchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid resource filter parameters',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const resources = await repo.listResources(parsed.data);
        res.status(200).json({
          success: true,
          count: resources.length,
          data: resources,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /operations/resources - Register new rescue vehicle (RBAC: MANAGE_RESOURCES)
  router.post(
    '/resources',
    requirePermission('MANAGE_RESOURCES'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = RegisterResourceSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid vehicle registration payload',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const model = getVehicleCatalogModel(parsed.data.modelId);
        if (!model) {
          res.status(400).json({
            error: {
              code: 'INVALID_VEHICLE_MODEL',
              message: `Unknown or unapproved vehicle model: "${parsed.data.modelId}"`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const vehicleName = parsed.data.name?.trim() || model.name;
        const capacity = parsed.data.capacity ?? model.defaultCapacity;
        const speedKmH = parsed.data.speedKmH ?? model.defaultSpeedKmH;

        if (capacity < model.minCapacity || capacity > model.maxCapacity) {
          res.status(400).json({
            error: {
              code: 'CAPACITY_OUT_OF_RANGE',
              message: `Capacity ${capacity} is outside the allowed range for model "${model.name}" (${model.minCapacity} to ${model.maxCapacity} passengers)`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        if (speedKmH < model.minSpeedKmH || speedKmH > model.maxSpeedKmH) {
          res.status(400).json({
            error: {
              code: 'SPEED_OUT_OF_RANGE',
              message: `Speed ${speedKmH} km/h is outside the allowed range for model "${model.name}" (${model.minSpeedKmH} to ${model.maxSpeedKmH} km/h)`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        // Validate coordinates against Delhi NCR service area policy
        try {
          await areaService.assertWithinServiceArea(parsed.data.lat, parsed.data.lng);
        } catch (locErr: unknown) {
          const errWithStatus = locErr as {
            statusCode?: number;
            code?: string;
            message?: string;
            details?: unknown;
          };
          if (errWithStatus.statusCode && errWithStatus.code) {
            res.status(errWithStatus.statusCode).json({
              error: {
                code: errWithStatus.code,
                message: errWithStatus.message,
                details: errWithStatus.details,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          throw locErr;
        }

        // Determine Resource ID
        let resourceId: string;
        if (parsed.data.id) {
          const customId = parsed.data.id.trim();
          const existing = await repo.getResourceById(customId);
          if (existing) {
            res.status(409).json({
              error: {
                code: 'DUPLICATE_RESOURCE_ID',
                message: `A resource with ID "${customId}" already exists. Resource IDs must be globally unique.`,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          resourceId = customId;
        } else {
          // Automatic collision-resistant ID generation
          let generatedId = `res-${crypto.randomBytes(4).toString('hex')}`;
          let attempts = 0;
          while (await repo.getResourceById(generatedId)) {
            generatedId = `res-${crypto.randomBytes(4).toString('hex')}`;
            attempts++;
            if (attempts > 5) break;
          }
          resourceId = generatedId;
        }

        const operatorId = req.operator?.username ?? req.operator?.id ?? 'OPERATOR';

        // Transactional create-only insertion and audit event
        const createdResource = await repo.withTransaction(async (txRepo) => {
          const resRow = await txRepo.createResource(
            {
              id: resourceId,
              name: vehicleName,
              type: model.type,
              capacity,
              speedKmH,
              lat: parsed.data.lat,
              lng: parsed.data.lng,
              status: parsed.data.status,
              depotId: parsed.data.depotId || undefined,
              source: 'REAL',
              modelId: model.id,
              notes: parsed.data.notes || undefined,
            },
            'REAL',
            operatorId,
          );

          await txRepo.insertAuditEvent({
            entityType: 'RESOURCE',
            entityId: resourceId,
            eventType: 'RESOURCE_REGISTERED',
            actor: operatorId,
            payload: {
              resourceId,
              name: vehicleName,
              type: model.type,
              modelId: model.id,
              capacity,
              speedKmH,
              lat: parsed.data.lat,
              lng: parsed.data.lng,
              status: parsed.data.status,
              source: 'REAL',
              depotId: parsed.data.depotId || null,
              notes: parsed.data.notes || null,
            },
          });

          return resRow;
        });

        res.status(201).json({
          success: true,
          data: {
            resource: createdResource,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /operations/resources/:id - Get specific resource (RBAC: VIEW_EVENTS)
  router.get(
    '/resources/:id',
    requirePermission('VIEW_EVENTS'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Resource ID parameter is required',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const resource = await repo.getResourceById(id);
        if (!resource) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: `Rescue resource with id "${id}" not found`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        res.status(200).json({
          success: true,
          data: resource,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // PATCH /operations/resources/:id - Edit permitted vehicle details (RBAC: MANAGE_RESOURCES)
  router.patch(
    '/resources/:id',
    requirePermission('MANAGE_RESOURCES'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Resource ID parameter is required',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const parsed = UpdateResourceDetailsSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid vehicle update payload',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        // Validate coordinates if provided
        if (parsed.data.lat !== undefined && parsed.data.lng !== undefined) {
          try {
            await areaService.assertWithinServiceArea(parsed.data.lat, parsed.data.lng);
          } catch (locErr: unknown) {
            const errWithStatus = locErr as {
              statusCode?: number;
              code?: string;
              message?: string;
              details?: unknown;
            };
            if (errWithStatus.statusCode && errWithStatus.code) {
              res.status(errWithStatus.statusCode).json({
                error: {
                  code: errWithStatus.code,
                  message: errWithStatus.message,
                  details: errWithStatus.details,
                  timestamp: new Date().toISOString(),
                },
              });
              return;
            }
            throw locErr;
          }
        }

        let model = undefined;
        if (parsed.data.modelId) {
          model = getVehicleCatalogModel(parsed.data.modelId);
          if (!model) {
            res.status(400).json({
              error: {
                code: 'INVALID_VEHICLE_MODEL',
                message: `Unknown or unapproved vehicle model: "${parsed.data.modelId}"`,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
        }

        const operatorId = req.operator?.username ?? req.operator?.id ?? 'OPERATOR';

        let updatedResource;
        try {
          updatedResource = await repo.withTransaction(async (txRepo, client) => {
            // Lock row with SELECT FOR UPDATE
            const lockResult = await client.query<{
              id: string;
              name: string;
              type: string;
              capacity: number;
              speed_km_h: number;
              source: string;
              status: string;
              version: number;
            }>(
              'SELECT id, name, type, capacity, speed_km_h, source, status, version FROM resources WHERE id = $1 FOR UPDATE;',
              [id],
            );
            const lockedRow = lockResult.rows[0];
            if (!lockedRow) {
              const err = new Error(`Rescue resource with id "${id}" not found`);
              (err as unknown as { code: string; statusCode: number }).code = 'NOT_FOUND';
              (err as unknown as { code: string; statusCode: number }).statusCode = 404;
              throw err;
            }

            if (lockedRow.source === 'SIMULATED') {
              const err = new Error(
                `Cannot modify details of simulated resource "${id}". Editing is restricted to authentic operational resources.`,
              );
              (err as unknown as { code: string; statusCode: number }).code =
                'SIMULATED_RESOURCE_MUTATION_BLOCKED';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }

            if (
              parsed.data.expectedVersion !== undefined &&
              lockedRow.version !== parsed.data.expectedVersion
            ) {
              const err = new Error(
                `Resource "${id}" was modified by another operator (expected version ${parsed.data.expectedVersion}, current version ${lockedRow.version}). Please refresh and try again.`,
              );
              (err as unknown as { code: string; statusCode: number }).code =
                'CONCURRENCY_CONFLICT';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }

            // Active assignment check: Reject edits altering operational parameters if assigned to an active committed plan
            const activeAssignments = await txRepo.getActiveCommittedAssignmentsForResource(id);
            if (activeAssignments.length > 0) {
              const altersConstraints =
                (parsed.data.capacity !== undefined &&
                  parsed.data.capacity !== lockedRow.capacity) ||
                (parsed.data.speedKmH !== undefined &&
                  parsed.data.speedKmH !== lockedRow.speed_km_h) ||
                (parsed.data.lat !== undefined && parsed.data.lng !== undefined);

              if (altersConstraints) {
                const activePlan = activeAssignments[0]!;
                const err = new Error(
                  `Cannot modify capacity, speed, or location of resource "${id}" while it is assigned to an active committed rescue plan (Assignment ID "${activePlan.id}", status ${activePlan.status}). Reassign or complete the plan first.`,
                );
                (err as unknown as { code: string; statusCode: number }).code =
                  'RESOURCE_ACTIVE_IN_COMMITTED_PLAN';
                (err as unknown as { code: string; statusCode: number }).statusCode = 409;
                throw err;
              }
            }

            const updated = await txRepo.updateResourceDetails(
              id,
              {
                name: parsed.data.name,
                type: model?.type,
                modelId: parsed.data.modelId,
                capacity: parsed.data.capacity,
                speedKmH: parsed.data.speedKmH,
                lat: parsed.data.lat,
                lng: parsed.data.lng,
                depotId: parsed.data.depotId,
                notes: parsed.data.notes,
                expectedVersion: parsed.data.expectedVersion,
              },
              operatorId,
            );

            if (!updated) {
              const err = new Error(
                `Failed to update resource "${id}". Concurrency conflict detected.`,
              );
              (err as unknown as { code: string; statusCode: number }).code =
                'CONCURRENCY_CONFLICT';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }

            await txRepo.insertAuditEvent({
              entityType: 'RESOURCE',
              entityId: id,
              eventType: 'RESOURCE_DETAILS_UPDATED',
              actor: operatorId,
              payload: {
                resourceId: id,
                changes: parsed.data,
                previousVersion: lockedRow.version,
                newVersion: updated.version,
              },
            });

            return updated;
          });
        } catch (domainErr: unknown) {
          const code = (domainErr as { code?: string }).code;
          if (code) {
            const statusCode = (domainErr as { statusCode?: number }).statusCode || 409;
            res.status(statusCode).json({
              error: {
                code,
                message: (domainErr as Error).message,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          throw domainErr;
        }

        res.status(200).json({
          success: true,
          data: {
            resource: updatedResource,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // PATCH /operations/resources/:id/status - Update resource status (RBAC: MANAGE_RESOURCE_STATUS)
  router.patch(
    '/resources/:id/status',
    requirePermission('MANAGE_RESOURCE_STATUS'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Resource ID parameter is required',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const parsed = UpdateResourceStatusSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid resource status update payload',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const existingResource = await repo.getResourceById(id);
        if (!existingResource) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: `Rescue resource with id "${id}" not found`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        if (existingResource.source === 'SIMULATED') {
          res.status(409).json({
            error: {
              code: 'SIMULATED_RESOURCE_MUTATION_BLOCKED',
              message: `Cannot modify operational status of simulated resource "${id}". Status updates are restricted to authentic operational resources.`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const newStatus = parsed.data.status;
        const operatorId = req.operator?.username ?? req.operator?.id ?? 'OPERATOR';
        const reason = parsed.data.reason ?? `Resource status changed to ${newStatus}`;

        // Determine operational event type
        const eventType =
          newStatus === 'OFFLINE' || newStatus === 'MAINTENANCE'
            ? 'RESOURCE_OFFLINE'
            : newStatus === 'AVAILABLE'
              ? 'RESOURCE_AVAILABLE'
              : null;

        let result;
        try {
          result = await repo.withTransaction(async (txRepo, client) => {
            // Lock row and enforce transactional provenance check to prevent TOCTOU races
            const lockResult = await client.query<{ id: string; status: string; source: string }>(
              'SELECT id, status, source FROM resources WHERE id = $1 FOR UPDATE;',
              [id],
            );
            const lockedRow = lockResult.rows[0];
            if (!lockedRow) {
              const err = new Error(`Rescue resource with id "${id}" not found`);
              (err as unknown as { code: string; statusCode: number }).code = 'NOT_FOUND';
              (err as unknown as { code: string; statusCode: number }).statusCode = 404;
              throw err;
            }

            if (lockedRow.source === 'SIMULATED') {
              const err = new Error(
                `Cannot modify operational status of simulated resource "${id}". Status updates are restricted to authentic operational resources.`,
              );
              (err as unknown as { code: string; statusCode: number }).code =
                'SIMULATED_RESOURCE_MUTATION_BLOCKED';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }

            const updatedResource = await txRepo.updateResourceStatus(id, newStatus);
            if (!updatedResource) {
              const err = new Error(`Failed to update status for resource "${id}"`);
              (err as unknown as { code: string; statusCode: number }).code =
                'SIMULATED_RESOURCE_MUTATION_BLOCKED';
              (err as unknown as { code: string; statusCode: number }).statusCode = 409;
              throw err;
            }

            let opEvent = null;
            if (eventType) {
              const eventResult = await eventService.recordEvent(
                {
                  id: `evt-${crypto.randomUUID().slice(0, 8)}`,
                  type: eventType,
                  entityType: 'RESOURCE',
                  entityId: id,
                  actorId: operatorId,
                  actorType: 'OPERATOR',
                  payload: {
                    resourceId: id,
                    previousStatus: lockedRow.status,
                    newStatus,
                    reason,
                  },
                },
                txRepo,
              );
              opEvent = eventResult.event;
            }

            await txRepo.insertAuditEvent({
              entityType: 'RESOURCE',
              entityId: id,
              eventType: eventType ?? `RESOURCE_STATUS_${newStatus}`,
              actor: operatorId,
              payload: {
                resourceId: id,
                previousStatus: lockedRow.status,
                newStatus,
                reason,
              },
            });

            return { updatedResource, opEvent };
          });
        } catch (domainErr: unknown) {
          const code = (domainErr as { code?: string }).code;
          if (code) {
            const statusCode = (domainErr as { statusCode?: number }).statusCode || 409;
            res.status(statusCode).json({
              error: {
                code,
                message: (domainErr as Error).message,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          throw domainErr;
        }

        // Compute affected scope if an event was produced
        let affectedScope = null;
        if (result.opEvent) {
          const processRes = await eventService.processEvent(result.opEvent.id);
          affectedScope = processRes.affectedScope;
        }

        res.status(200).json({
          success: true,
          data: {
            resource: result.updatedResource,
            event: result.opEvent,
            affectedScope,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /operations/road-zones - Record new hazard/blocked zone (RBAC: MANAGE_BLOCKED_ZONES)
  router.post(
    '/road-zones',
    requirePermission('MANAGE_BLOCKED_ZONES'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = CreateRoadZoneSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid road zone payload',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const operatorId = req.operator?.username ?? req.operator?.id ?? 'OPERATOR';
        const zoneId = `bz-${crypto.randomUUID().slice(0, 8)}`;

        const result = await repo.withTransaction(async (txRepo) => {
          const dbZone = await txRepo.insertBlockedZone({
            id: zoneId,
            name: parsed.data.name,
            severity: parsed.data.severity,
            polygon: parsed.data.polygon,
            createdBy: operatorId,
          });

          const eventResult = await eventService.recordEvent(
            {
              id: `evt-${crypto.randomUUID().slice(0, 8)}`,
              type: 'ROAD_BLOCKED',
              entityType: 'ROAD_ZONE',
              entityId: zoneId,
              actorId: operatorId,
              actorType: 'OPERATOR',
              payload: {
                zoneId,
                name: parsed.data.name,
                severity: parsed.data.severity,
                reason: parsed.data.reason ?? 'Road closure recorded by operator',
              },
            },
            txRepo,
          );

          await txRepo.insertAuditEvent({
            entityType: 'ROAD_ZONE',
            entityId: zoneId,
            eventType: 'ROAD_BLOCKED',
            actor: operatorId,
            payload: {
              zoneId,
              name: parsed.data.name,
              severity: parsed.data.severity,
            },
          });

          return {
            zone: dbToBlockedZone(dbZone),
            event: eventResult.event,
          };
        });

        // Compute affected scope
        const processRes = await eventService.processEvent(result.event.id);

        res.status(201).json({
          success: true,
          data: {
            zone: result.zone,
            event: result.event,
            affectedScope: processRes.affectedScope,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /operations/road-zones/:id - Reopen blocked zone (RBAC: MANAGE_BLOCKED_ZONES)
  router.delete(
    '/road-zones/:id',
    requirePermission('MANAGE_BLOCKED_ZONES'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawId = req.params.id;
        const id = Array.isArray(rawId) ? rawId[0] : rawId;
        if (!id) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Zone ID parameter is required',
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const existingZone = await repo.getBlockedZone(id);
        if (!existingZone) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: `Blocked zone with id "${id}" not found`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        const operatorId = req.operator?.username ?? req.operator?.id ?? 'OPERATOR';

        const result = await repo.withTransaction(async (txRepo) => {
          await txRepo.updateBlockedZoneStatus(id, false);

          const eventResult = await eventService.recordEvent(
            {
              id: `evt-${crypto.randomUUID().slice(0, 8)}`,
              type: 'ROAD_REOPENED',
              entityType: 'ROAD_ZONE',
              entityId: id,
              actorId: operatorId,
              actorType: 'OPERATOR',
              payload: {
                zoneId: id,
                name: existingZone.name,
                reopenedBy: operatorId,
              },
            },
            txRepo,
          );

          await txRepo.insertAuditEvent({
            entityType: 'ROAD_ZONE',
            entityId: id,
            eventType: 'ROAD_REOPENED',
            actor: operatorId,
            payload: {
              zoneId: id,
              name: existingZone.name,
            },
          });

          const updatedDb = await txRepo.getBlockedZone(id);
          return {
            zone: updatedDb ? dbToBlockedZone(updatedDb) : null,
            event: eventResult.event,
          };
        });

        // Compute affected scope
        const processRes = await eventService.processEvent(result.event.id);

        res.status(200).json({
          success: true,
          data: {
            zone: result.zone,
            event: result.event,
            affectedScope: processRes.affectedScope,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /operations/repair - Request plan repair proposal (RBAC: REQUEST_REPAIR)
  router.post(
    '/repair',
    requirePermission('REQUEST_REPAIR'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = RequestRepairSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid repair request payload',
              details: parsed.error.format(),
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        try {
          const repairResult = await repairService.orchestrateRepair(parsed.data.eventId, {
            baselineAssignmentId: parsed.data.baselineAssignmentId,
            expectedVersion: parsed.data.expectedVersion,
          });

          res.status(200).json({
            success: true,
            data: repairResult,
          });
        } catch (domainErr) {
          const code = (domainErr as { code?: string }).code;
          const statusCode = (domainErr as { statusCode?: number }).statusCode;
          if (code && statusCode) {
            res.status(statusCode).json({
              error: {
                code,
                message: (domainErr as Error).message,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          throw domainErr;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
