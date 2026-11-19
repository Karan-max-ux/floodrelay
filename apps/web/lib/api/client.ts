export {
  ApiClientError,
  isAbortError,
  isOutsideServiceArea,
  isServiceAreaUnavailable,
} from './errors';
import { ApiClientError, isAbortError } from './errors';
import type {
  ApiResponse,
  CreateRequestInput,
  RescueRequest,
  ServiceAreaCheckResult,
  ListRequestsFilter,
  NearbyRequestsFilter,
  AssignmentRecord,
  ProposeAssignmentInput,
  CommitAssignmentInput,
  ModifyStopInput,
  RouteStop,
  OperatorProfile,
  LoginResult,
  OperationalEvent,
  AffectedScopeResult,
  AffectedScopeResponse,
  RepairResult,
  ListOperationalEventsFilter,
  ListAuditEventsFilter,
  ListResourcesFilter,
  AuditEventRecord,
  RescueResource,
  UpdateResourceStatusInput,
  UpdateResourceStatusResult,
  CreateRoadZoneInput,
  RoadZoneOperationResult,
  RequestRepairInput,
  FloodForecastContext,
} from './types';

export interface ApiClientConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  authToken?: string | null;
}

export class FloodRelayApiClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private authToken: string | null = null;

  constructor(config: ApiClientConfig = {}) {
    const isBrowser = typeof window !== 'undefined';
    const configuredUrl = config.baseUrl || process.env.NEXT_PUBLIC_API_URL;
    // In browser, default to relative '' to leverage Next.js proxy rewrites; in Node/SSR default to http://localhost:3000
    this.baseUrl = (configuredUrl ?? (isBrowser ? '' : 'http://localhost:3000')).replace(/\/$/, '');
    this.authToken = config.authToken || null;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...config.defaultHeaders,
    };
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.authToken && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers,
      });
    } catch (err) {
      // Preserve intentional abort/cancellation semantics rather than wrapping as NETWORK_ERROR
      if (options.signal?.aborted || isAbortError(err)) {
        throw err;
      }
      throw new ApiClientError({
        message: `Failed to connect to FloodRelay API at ${url}: ${(err as Error).message}`,
        statusCode: 0,
        code: 'NETWORK_ERROR',
        isNetworkError: true,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      if (options.signal?.aborted || isAbortError(err)) {
        throw err;
      }
      payload = null;
    }

    if (!response.ok) {
      const errorObj = (
        payload as { error?: { message?: string; code?: string; details?: unknown } }
      )?.error;
      const message = errorObj?.message || `API request failed with HTTP ${response.status}`;
      const code = errorObj?.code || `HTTP_${response.status}`;
      const details = errorObj?.details;

      throw new ApiClientError({
        message,
        statusCode: response.status,
        code,
        details,
      });
    }

    return payload as ApiResponse<T>;
  }

  // Health
  async getHealth(
    signal?: AbortSignal,
  ): Promise<{ status: string; timestamp: string; database?: string; version?: string }> {
    const res = await this.request<{
      status: string;
      timestamp: string;
      database?: string;
      version?: string;
    }>('/health', {
      method: 'GET',
      signal,
    });
    return res.data;
  }

  // ==========================================
  // Operator Authentication Endpoints
  // ==========================================

  async login(username: string, password: string, signal?: AbortSignal): Promise<LoginResult> {
    const res = await this.request<LoginResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      signal,
    });
    if (res.data?.token) {
      this.setAuthToken(res.data.token);
    }
    return res.data;
  }

  async logout(signal?: AbortSignal): Promise<{ message: string }> {
    const res = await this.request<{ message: string }>('/auth/logout', {
      method: 'POST',
      signal,
    });
    this.setAuthToken(null);
    return res.data || { message: 'Logged out' };
  }

  async getMe(signal?: AbortSignal): Promise<OperatorProfile> {
    const res = await this.request<{ operator: OperatorProfile }>('/auth/me', {
      method: 'GET',
      signal,
    });
    return res.data.operator;
  }

  // Citizen & Operator Request Endpoints
  async checkServiceArea(
    lat: number,
    lng: number,
    signal?: AbortSignal,
    accuracy?: number,
  ): Promise<ServiceAreaCheckResult> {
    const res = await this.request<ServiceAreaCheckResult>('/requests/service-area-check', {
      method: 'POST',
      body: JSON.stringify({
        lat,
        lng,
        ...(typeof accuracy === 'number' && Number.isFinite(accuracy) ? { accuracy } : {}),
      }),
      signal,
    });
    return res.data;
  }

  async createRequest(
    input: CreateRequestInput,
    signal?: AbortSignal,
  ): Promise<RescueRequest & { idempotent?: boolean }> {
    const headers: Record<string, string> = {};
    if (input.idempotencyKey) {
      headers['Idempotency-Key'] = input.idempotencyKey;
    }

    const res = await this.request<RescueRequest>('/requests', {
      method: 'POST',
      body: JSON.stringify(input),
      headers,
      signal,
    });
    return {
      ...res.data,
      idempotent: Boolean(res.idempotent),
    };
  }

  async getRequest(id: string, signal?: AbortSignal): Promise<RescueRequest> {
    const res = await this.request<RescueRequest>(`/requests/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal,
    });
    return res.data;
  }

  async listRequests(filter?: ListRequestsFilter, signal?: AbortSignal): Promise<RescueRequest[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.urgency) params.set('urgency', filter.urgency);
    if (filter?.limit) params.set('limit', String(filter.limit));
    if (filter?.offset) params.set('offset', String(filter.offset));

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<RescueRequest[]>(`/requests${qs}`, {
      method: 'GET',
      signal,
    });
    return res.data;
  }

  async listNearbyRequests(
    filter: NearbyRequestsFilter,
    signal?: AbortSignal,
  ): Promise<RescueRequest[]> {
    const params = new URLSearchParams({
      lat: String(filter.lat),
      lng: String(filter.lng),
    });
    if (filter.radiusKm) params.set('radiusKm', String(filter.radiusKm));
    if (filter.status) params.set('status', filter.status);
    if (filter.limit) params.set('limit', String(filter.limit));

    const res = await this.request<RescueRequest[]>(`/requests/nearby?${params.toString()}`, {
      method: 'GET',
      signal,
    });
    return res.data;
  }

  // Operator Assignment Endpoints
  async listAssignments(
    filter?: {
      status?: 'PROPOSED' | 'COMMITTED';
      scenarioId?: string;
      limit?: number;
      offset?: number;
    },
    signal?: AbortSignal,
  ): Promise<AssignmentRecord[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.scenarioId) params.set('scenarioId', filter.scenarioId);
    if (filter?.limit) params.set('limit', String(filter.limit));
    if (filter?.offset) params.set('offset', String(filter.offset));

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<AssignmentRecord[]>(`/assignments${qs}`, {
      method: 'GET',
      signal,
    });
    return res.data;
  }

  async getAssignment(id: string, signal?: AbortSignal): Promise<AssignmentRecord> {
    const res = await this.request<AssignmentRecord>(`/assignments/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal,
    });
    return res.data;
  }

  async proposeAssignment(
    input: ProposeAssignmentInput,
    signal?: AbortSignal,
  ): Promise<AssignmentRecord> {
    const res = await this.request<AssignmentRecord>('/assignments/propose', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
    return res.data;
  }

  async commitAssignment(
    id: string,
    input: CommitAssignmentInput,
    signal?: AbortSignal,
  ): Promise<AssignmentRecord> {
    const res = await this.request<AssignmentRecord>(
      `/assignments/${encodeURIComponent(id)}/commit`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal,
      },
    );
    return res.data;
  }

  async modifyStop(
    assignmentId: string,
    stopId: string,
    input: ModifyStopInput,
    operatorId = 'OPERATOR',
    signal?: AbortSignal,
  ): Promise<RouteStop> {
    const res = await this.request<RouteStop>(
      `/assignments/${encodeURIComponent(assignmentId)}/stops/${encodeURIComponent(stopId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
        headers: {
          'x-operator-id': operatorId,
        },
        signal,
      },
    );
    return res.data;
  }

  // ==========================================
  // Phase 5 Operations & Operational Events Endpoints
  // ==========================================

  async listOperationalEvents(
    filter?: ListOperationalEventsFilter,
    signal?: AbortSignal,
  ): Promise<OperationalEvent[]> {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.entityType) params.set('entityType', filter.entityType);
    if (filter?.entityId) params.set('entityId', filter.entityId);
    if (filter?.status) params.set('status', filter.status);
    if (filter?.actorId) params.set('actorId', filter.actorId);
    if (filter?.limit) params.set('limit', String(filter.limit));
    if (filter?.offset) params.set('offset', String(filter.offset));

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<OperationalEvent[]>(`/operations/events${qs}`, {
      method: 'GET',
      signal,
    });
    return res.data || [];
  }

  async getOperationalEvents(
    filter?: ListOperationalEventsFilter,
    signal?: AbortSignal,
  ): Promise<OperationalEvent[]> {
    return this.listOperationalEvents(filter, signal);
  }

  async getOperationalEvent(id: string, signal?: AbortSignal): Promise<OperationalEvent> {
    const res = await this.request<OperationalEvent>(
      `/operations/events/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        signal,
      },
    );
    return res.data;
  }

  async getAffectedScope(id: string, signal?: AbortSignal): Promise<AffectedScopeResult> {
    const res = await this.request<AffectedScopeResponse>(
      `/operations/events/${encodeURIComponent(id)}/affected-scope`,
      {
        method: 'GET',
        signal,
      },
    );

    const data = res?.data;
    const scope = data?.affectedScope;

    if (
      !data ||
      !scope ||
      !Array.isArray(scope.affectedRequestIds) ||
      !Array.isArray(scope.affectedResourceIds) ||
      !Array.isArray(scope.affectedProposedAssignmentIds) ||
      !Array.isArray(scope.committedAssignmentsRequiringReview)
    ) {
      throw new ApiClientError({
        message:
          'Unexpected affected-scope response shape: missing affectedScope or required array fields',
        statusCode: 500,
        code: 'MALFORMED_RESPONSE',
      });
    }

    return scope;
  }

  async listResources(
    filter?: ListResourcesFilter,
    signal?: AbortSignal,
  ): Promise<RescueResource[]> {
    const params = new URLSearchParams();
    if (filter?.status) {
      params.set('status', filter.status);
    }
    if (filter?.type) {
      params.set('type', filter.type);
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<RescueResource[]>(`/operations/resources${query}`, {
      method: 'GET',
      signal,
    });
    return res.data;
  }

  async updateResourceStatus(
    id: string,
    input: UpdateResourceStatusInput,
    signal?: AbortSignal,
  ): Promise<UpdateResourceStatusResult> {
    const res = await this.request<UpdateResourceStatusResult>(
      `/operations/resources/${encodeURIComponent(id)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
        signal,
      },
    );
    return res.data;
  }

  async createRoadZone(
    input: CreateRoadZoneInput,
    signal?: AbortSignal,
  ): Promise<RoadZoneOperationResult> {
    const res = await this.request<RoadZoneOperationResult>('/operations/road-zones', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
    return res.data;
  }

  async reopenRoadZone(id: string, signal?: AbortSignal): Promise<RoadZoneOperationResult> {
    const res = await this.request<RoadZoneOperationResult>(
      `/operations/road-zones/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        signal,
      },
    );
    return res.data;
  }

  async requestRepair(input: RequestRepairInput, signal?: AbortSignal): Promise<RepairResult> {
    const res = await this.request<RepairResult>('/operations/repair', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
    return res.data;
  }

  // ==========================================
  // Audit Trail Endpoints
  // ==========================================

  async listAuditEvents(
    filter?: ListAuditEventsFilter,
    signal?: AbortSignal,
  ): Promise<AuditEventRecord[]> {
    const params = new URLSearchParams();
    if (filter?.entityType) params.set('entityType', filter.entityType);
    if (filter?.entityId) params.set('entityId', filter.entityId);
    if (filter?.eventType) params.set('eventType', filter.eventType);
    if (filter?.actor) params.set('actor', filter.actor);
    if (filter?.limit) params.set('limit', String(filter.limit));
    if (filter?.offset) params.set('offset', String(filter.offset));

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<AuditEventRecord[]>(`/audit/events${qs}`, {
      method: 'GET',
      signal,
    });
    return res.data || [];
  }

  // ==========================================
  // Flood Forecast Context Endpoints (Phase 6)
  // ==========================================

  async getFloodForecast(
    options?: { lat?: number; lng?: number; days?: number; forceRefresh?: boolean },
    signal?: AbortSignal,
  ): Promise<FloodForecastContext> {
    const params = new URLSearchParams();
    if (options?.lat !== undefined) params.set('lat', String(options.lat));
    if (options?.lng !== undefined) params.set('lng', String(options.lng));
    if (options?.days !== undefined) params.set('days', String(options.days));
    if (options?.forceRefresh) params.set('forceRefresh', 'true');

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<FloodForecastContext>(`/forecast/context${qs}`, {
      method: 'GET',
      signal,
    });
    return res.data;
  }
}

export const apiClient = new FloodRelayApiClient();
