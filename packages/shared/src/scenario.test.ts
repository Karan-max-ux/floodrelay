import { describe, expect, it } from 'vitest';
import { validateScenario, type Scenario } from './index.js';

describe('validateScenario', () => {
  const validScenario: Scenario = {
    id: 'scenario-delhi-01',
    metadata: {
      id: 'scenario-delhi-01',
      name: 'Yamuna Flood Response',
      region: 'Delhi NCR',
      seed: 42,
      createdAt: '2026-10-15T12:00:00.000Z',
      bounds: {
        minLat: 28.5,
        maxLat: 28.8,
        minLng: 77.1,
        maxLng: 77.4,
      },
    },
    requests: [
      {
        id: 'req-01',
        lat: 28.6139,
        lng: 77.209,
        peopleCount: 4,
        urgency: 'HIGH',
        createdAt: '2026-10-15T12:05:00.000Z',
        source: 'SIMULATED',
      },
      {
        id: 'req-02',
        lat: 28.62,
        lng: 77.215,
        peopleCount: 2,
        urgency: 'CRITICAL',
        createdAt: '2026-10-15T12:10:00.000Z',
        source: 'SIMULATED',
      },
    ],
    resources: [
      {
        id: 'res-boat-01',
        name: 'Inflatable Rescue Boat 1',
        type: 'BOAT',
        capacity: 8,
        speedKmH: 25,
        lat: 28.61,
        lng: 77.2,
        status: 'AVAILABLE',
      },
    ],
    shelters: [
      {
        id: 'shelter-01',
        name: 'Relief Camp Stadium',
        lat: 28.63,
        lng: 77.22,
        capacity: 100,
        currentOccupancy: 15,
      },
    ],
    blockedZones: [
      {
        id: 'zone-bridge-submerged',
        severity: 'BLOCKED',
        polygon: [
          { lat: 28.615, lng: 77.21 },
          { lat: 28.616, lng: 77.212 },
          { lat: 28.614, lng: 77.212 },
        ],
      },
    ],
  };

  it('accepts a fully-formed valid scenario', () => {
    const res = validateScenario(validScenario);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects null or non-object input', () => {
    expect(validateScenario(null).valid).toBe(false);
    expect(validateScenario('not a scenario').valid).toBe(false);
  });

  it('rejects missing or empty id', () => {
    const invalid = { ...validScenario, id: '' };
    const res = validateScenario(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Scenario id must be a non-empty string');
  });

  it('rejects invalid bounding box', () => {
    const invalid = {
      ...validScenario,
      metadata: {
        ...validScenario.metadata,
        bounds: {
          minLat: 35.0,
          maxLat: 28.0, // min > max
          minLng: 77.0,
          maxLng: 78.0,
        },
      },
    };
    const res = validateScenario(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Metadata bounds minLat must be less than or equal to maxLat');
  });

  it('detects duplicate request IDs', () => {
    const invalid = {
      ...validScenario,
      requests: [
        validScenario.requests[0],
        { ...validScenario.requests[0] }, // duplicate id
      ],
    };
    const res = validateScenario(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Duplicate request id'))).toBe(true);
  });

  it('rejects request with non-positive people count or invalid coordinates', () => {
    const invalid = {
      ...validScenario,
      requests: [
        {
          id: 'bad-req',
          lat: 95.0, // invalid latitude
          lng: 77.2,
          peopleCount: -1,
          urgency: 'HIGH',
          createdAt: '2026-10-15T12:00:00Z',
          source: 'SIMULATED',
        },
      ],
    };
    const res = validateScenario(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('invalid lat/lng'))).toBe(true);
    expect(res.errors.some((e) => e.includes('positive integer'))).toBe(true);
  });

  it('rejects resource with invalid type or negative capacity', () => {
    const invalid = {
      ...validScenario,
      resources: [
        {
          id: 'bad-res',
          name: 'Invalid Vehicle',
          type: 'SUBMARINE' as unknown as 'BOAT',
          capacity: 0,
          speedKmH: 20,
          lat: 28.6,
          lng: 77.2,
          status: 'AVAILABLE',
        },
      ],
    };
    const res = validateScenario(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('invalid type'))).toBe(true);
    expect(res.errors.some((e) => e.includes('capacity must be a positive integer'))).toBe(true);
  });

  it('validates a scenario with blocked zones and multiple shelters', () => {
    const complexScenario: Scenario = {
      ...validScenario,
      shelters: [
        ...validScenario.shelters,
        {
          id: 'shelter-wazirabad',
          name: 'Wazirabad Community Relief Centre',
          lat: 28.705,
          lng: 77.228,
          capacity: 150,
          currentOccupancy: 35,
        },
      ],
      blockedZones: [
        {
          id: 'zone-bridge-01',
          name: 'Old Bridge Submerged',
          severity: 'BLOCKED',
          polygon: [
            { lat: 28.662, lng: 77.24 },
            { lat: 28.665, lng: 77.245 },
            { lat: 28.661, lng: 77.247 },
          ],
        },
      ],
    };
    const res = validateScenario(complexScenario);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
});
