export type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RequestSource = 'SIMULATED' | 'REPORTED';

export interface RescueRequest {
  id: string;
  lat: number;
  lng: number;
  peopleCount: number;
  urgency: UrgencyLevel;
  createdAt: string;
  source: RequestSource;
}
