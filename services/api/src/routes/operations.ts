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
  CreateRoadZoneSchema,
  RequestRepairSchema,
} from '../validation/operationsSchema.js';
import { dbToBlockedZone } from '../db/schema.js';

export function createOperationsRouter(
  repo: PostgisRepository,
  eventService: OperationalEventService,
  repairService: RepairOrchestrationService,
): Router {
  const router = Router();

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
