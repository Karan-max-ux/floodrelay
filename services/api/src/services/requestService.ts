import crypto from 'node:crypto';
import type { RescueRequest } from '@floodrelay/shared';
import { PostgisRepository } from '../db/repository.js';
import type { CreateRequestInput, ListRequestsFilter } from '../validation/requestSchema.js';

export const ASSUMED_DUPLICATE_RADIUS_METERS = 100;
export const ASSUMED_DUPLICATE_TIME_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
export const ASSUMED_DUPLICATE_PEOPLE_DELTA = 2; // +/- 2 people

export interface CreateRequestResult {
  idempotent: boolean;
  isFlaggedDuplicate: boolean;
  duplicateOfId: string | null;
  request: RescueRequest;
}

export class RequestService {
  constructor(private readonly repo: PostgisRepository) {}

  async submitRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
    // 1. Idempotency check
    if (input.idempotencyKey) {
      const existing = await this.repo.getRequestByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return {
          idempotent: true,
          isFlaggedDuplicate: false,
          duplicateOfId: null,
          request: existing,
        };
      }
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
      medicalNeeds: input.medicalNeeds ?? false,
      notes: input.notes,
    };

    // 4. Store in database
    await this.repo.insertRequest(request, {
      verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
      idempotencyKey: input.idempotencyKey ?? null,
      duplicateOfId,
      isFlaggedDuplicate,
    });

    // 5. Audit event log
    await this.repo.insertAuditEvent({
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
  }

  async getRequest(id: string): Promise<RescueRequest | null> {
    return this.repo.getRequestById(id);
  }

  async listRequests(filter?: ListRequestsFilter): Promise<RescueRequest[]> {
    return this.repo.listRequests(filter);
  }
}
