import crypto from 'node:crypto';
import type { RescueRequest } from '@floodrelay/shared';
import { PostgisRepository } from '../db/repository.js';
import type { CreateRequestInput, ListRequestsFilter } from '../validation/requestSchema.js';
import { ServiceAreaService, type ServiceAreaCheckResult } from './serviceAreaService.js';

export const ASSUMED_DUPLICATE_RADIUS_METERS = 100;
export const ASSUMED_DUPLICATE_TIME_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
export const ASSUMED_DUPLICATE_PEOPLE_DELTA = 2; // +/- 2 people

export interface CreateRequestResult {
  idempotent: boolean;
  isFlaggedDuplicate: boolean;
  duplicateOfId: string | null;
  request: RescueRequest;
}

export function computeCanonicalRequestHash(input: CreateRequestInput): string {
  const canonical = {
    lat: Number(input.lat.toFixed(6)),
    lng: Number(input.lng.toFixed(6)),
    medicalNeeds: Boolean(input.medicalNeeds),
    notes: input.notes?.trim() || null,
    peopleCount: input.peopleCount,
    source: input.source || 'REPORTED',
    urgency: input.urgency,
    verificationStatus: input.verificationStatus || 'UNVERIFIED',
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export class RequestService {
  private readonly serviceAreaService: ServiceAreaService;

  constructor(
    private readonly repo: PostgisRepository,
    serviceAreaService?: ServiceAreaService,
  ) {
    this.serviceAreaService = serviceAreaService ?? new ServiceAreaService(repo);
  }

  async checkServiceArea(lat: number, lng: number): Promise<ServiceAreaCheckResult> {
    return this.serviceAreaService.checkCoordinates(lat, lng);
  }

  async submitRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
    const requestHash = input.idempotencyKey ? computeCanonicalRequestHash(input) : null;

    // 1. Check for idempotency conflict (409) BEFORE service-area check so a reused key
    //    with a mutated payload preserves existing 409 IDEMPOTENCY_KEY_REUSED semantics.
    let existingIdempotent: (RescueRequest & { idempotencyRequestHash?: string | null }) | null =
      null;
    if (input.idempotencyKey && requestHash) {
      try {
        existingIdempotent = await this.repo.getRequestByIdempotencyKey(input.idempotencyKey);
      } catch (lookupErr) {
        // If database lookup fails, run service-area check (or fail safely with 503)
        console.error('[RequestService] Idempotency lookup failed:', lookupErr);
        await this.serviceAreaService.assertWithinServiceArea(input.lat, input.lng);
        throw lookupErr;
      }

      if (
        existingIdempotent &&
        existingIdempotent.idempotencyRequestHash &&
        existingIdempotent.idempotencyRequestHash !== requestHash
      ) {
        const err = new Error(
          `Idempotency key "${input.idempotencyKey}" has already been used for a different request payload`,
        );
        (err as unknown as { code: string; statusCode: number }).code = 'IDEMPOTENCY_KEY_REUSED';
        (err as unknown as { code: string; statusCode: number }).statusCode = 409;
        throw err;
      }
    }

    // 2. Authoritative service-area enforcement (PostGIS ST_Covers, fail-closed):
    //    Runs BEFORE returning an idempotent acknowledgement OR writing any request/event/audit row.
    //    Prevents silently returning an old successful receipt for a currently ineligible location.
    await this.serviceAreaService.assertWithinServiceArea(input.lat, input.lng);

    if (existingIdempotent) {
      return {
        idempotent: true,
        isFlaggedDuplicate: false,
        duplicateOfId: null,
        request: existingIdempotent,
      };
    }

    // 2. Duplicate detection (nearby, recent, similar passenger count)
    const twoHoursAgo = new Date(Date.now() - ASSUMED_DUPLICATE_TIME_WINDOW_MS);
    const nearby = await this.repo.findNearbyRequests(
      input.lat,
      input.lng,
      ASSUMED_DUPLICATE_RADIUS_METERS,
      { since: twoHoursAgo },
    );

    // Filter by people count similarity
    const potentialDuplicate = nearby.find((candidate) => {
      const delta = Math.abs(candidate.peopleCount - input.peopleCount);
      return delta <= ASSUMED_DUPLICATE_PEOPLE_DELTA;
    });

    const isFlaggedDuplicate = Boolean(potentialDuplicate);
    const duplicateOfId = potentialDuplicate ? potentialDuplicate.id : null;

    // 3. Create request object
    const id = `req-${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    const request: RescueRequest = {
      id,
      lat: input.lat,
      lng: input.lng,
      peopleCount: input.peopleCount,
      urgency: input.urgency,
      createdAt,
      source: input.source ?? 'REPORTED',
      status: 'PENDING',
      verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
      medicalNeeds: input.medicalNeeds ?? false,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey ?? null,
      isFlaggedDuplicate,
      duplicateOfId,
    };

    // 4. Store in database transactionally along with operational event and audit log
    try {
      return await this.repo.withTransaction(async (txRepo) => {
        await txRepo.insertRequest(request, {
          verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
          idempotencyKey: input.idempotencyKey ?? null,
          idempotencyRequestHash: requestHash,
          duplicateOfId,
          isFlaggedDuplicate,
        });

        // Operational Event (Phase 5)
        await txRepo.insertOperationalEvent({
          id: `evt-${crypto.randomUUID().slice(0, 8)}`,
          type: isFlaggedDuplicate ? 'REQUEST_FLAGGED_DUPLICATE' : 'REQUEST_CREATED',
          entityType: 'REQUEST',
          entityId: id,
          actorId: null,
          actorType: input.source === 'SIMULATED' ? 'SYSTEM' : 'CITIZEN',
          occurredAt: createdAt,
          payload: {
            id,
            urgency: input.urgency,
            peopleCount: input.peopleCount,
            isFlaggedDuplicate,
            duplicateOfId,
            verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
          },
          idempotencyKey: input.idempotencyKey ? `op-req-${input.idempotencyKey}` : null,
        });

        // Audit Event Log
        await txRepo.insertAuditEvent({
          entityType: 'REQUEST',
          entityId: id,
          eventType: isFlaggedDuplicate ? 'REQUEST_FLAGGED_DUPLICATE' : 'REQUEST_CREATED',
          actor: input.source === 'SIMULATED' ? 'SIMULATION' : 'CITIZEN',
          payload: {
            id,
            urgency: input.urgency,
            peopleCount: input.peopleCount,
            isFlaggedDuplicate,
            duplicateOfId,
            verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
          },
        });

        return {
          idempotent: false,
          isFlaggedDuplicate,
          duplicateOfId,
          request,
        };
      });
    } catch (insertErr: unknown) {
      const errMessage = (insertErr as Error)?.message || '';
      const errCode = (insertErr as { code?: string })?.code;
      const isUniqueViolation =
        errCode === '23505' ||
        errMessage.includes('unique') ||
        errMessage.includes('idempotency_key');

      if (input.idempotencyKey && isUniqueViolation) {
        const raced = await this.repo.getRequestByIdempotencyKey(input.idempotencyKey);
        if (raced) {
          if (raced.idempotencyRequestHash && raced.idempotencyRequestHash !== requestHash) {
            const err = new Error(
              `Idempotency key "${input.idempotencyKey}" has already been used for a different request payload`,
            );
            (err as unknown as { code: string; statusCode: number }).code =
              'IDEMPOTENCY_KEY_REUSED';
            (err as unknown as { code: string; statusCode: number }).statusCode = 409;
            throw err;
          }
          return {
            idempotent: true,
            isFlaggedDuplicate: false,
            duplicateOfId: null,
            request: raced,
          };
        }
      }
      throw insertErr;
    }
  }

  async cancelRequest(
    id: string,
    options?: {
      actorId?: string | null;
      actorType?: 'CITIZEN' | 'OPERATOR' | 'SYSTEM';
      reason?: string;
    },
  ): Promise<RescueRequest> {
    const existing = await this.repo.getRequestById(id);
    if (!existing) {
      const err = new Error(`Rescue request with id "${id}" not found`);
      (err as unknown as { code: string; statusCode: number }).code = 'NOT_FOUND';
      (err as unknown as { code: string; statusCode: number }).statusCode = 404;
      throw err;
    }

    if (existing.status === 'CANCELLED') {
      return existing;
    }

    if (
      existing.status === 'ASSIGNED' ||
      existing.status === 'IN_TRANSIT' ||
      existing.status === 'RESCUED'
    ) {
      const err = new Error(
        `Cannot cancel request "${id}" with status "${existing.status}". Active or committed rescue missions cannot be silently reversed.`,
      );
      (err as unknown as { code: string; statusCode: number }).code =
        'CANNOT_CANCEL_COMMITTED_REQUEST';
      (err as unknown as { code: string; statusCode: number }).statusCode = 409;
      throw err;
    }

    const actorId = options?.actorId ?? null;
    const actorType = options?.actorType ?? 'CITIZEN';
    const reason = options?.reason ?? 'Citizen cancellation request';

    return await this.repo.withTransaction(async (txRepo) => {
      await txRepo.updateRequestStatus(id, 'CANCELLED');

      await txRepo.insertOperationalEvent({
        id: `evt-${crypto.randomUUID().slice(0, 8)}`,
        type: 'REQUEST_CANCELLED',
        entityType: 'REQUEST',
        entityId: id,
        actorId,
        actorType,
        occurredAt: new Date().toISOString(),
        payload: {
          requestId: id,
          reason,
          previousStatus: existing.status,
        },
      });

      await txRepo.insertAuditEvent({
        entityType: 'REQUEST',
        entityId: id,
        eventType: 'REQUEST_CANCELLED',
        actor: actorId || (actorType === 'CITIZEN' ? 'CITIZEN' : 'OPERATOR'),
        payload: {
          requestId: id,
          reason,
          previousStatus: existing.status,
        },
      });

      const updated = await txRepo.getRequestById(id);
      return updated ?? { ...existing, status: 'CANCELLED' };
    });
  }

  async getRequest(id: string): Promise<RescueRequest | null> {
    return this.repo.getRequestById(id);
  }

  async listRequests(filter?: ListRequestsFilter): Promise<RescueRequest[]> {
    return this.repo.listRequests(filter);
  }
}
