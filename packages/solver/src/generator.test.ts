import { validateScenario } from '@floodrelay/shared';
import { describe, expect, it } from 'vitest';
import { generateScenario, SeededRNG } from './generator.js';

describe('SeededRNG', () => {
  it('generates identical sequences for the same seed', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);

    for (let i = 0; i < 20; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('generates different sequences for different seeds', () => {
    const rng1 = new SeededRNG(1);
    const rng2 = new SeededRNG(2);
    expect(rng1.next()).not.toBe(rng2.next());
  });
});

describe('generateScenario', () => {
  it('is completely reproducible with the same seed', () => {
    const s1 = generateScenario({ seed: 12345, requestCount: 20, resourceCount: 4 });
    const s2 = generateScenario({ seed: 12345, requestCount: 20, resourceCount: 4 });

    expect(s1.requests).toEqual(s2.requests);
    expect(s1.resources).toEqual(s2.resources);
    expect(s1.shelters).toEqual(s2.shelters);
  });

  it('produces different results with different seeds', () => {
    const s1 = generateScenario({ seed: 100, requestCount: 10 });
    const s2 = generateScenario({ seed: 200, requestCount: 10 });

    expect(s1.requests[0]?.lat).not.toBe(s2.requests[0]?.lat);
  });

  it('labels every single generated request as SIMULATED', () => {
    const scenario = generateScenario({ seed: 777, requestCount: 30 });
    for (const req of scenario.requests) {
      expect(req.source).toBe('SIMULATED');
    }
  });

  it('generates scenarios that pass strict validateScenario checks', () => {
    const scenario = generateScenario({
      seed: 999,
      requestCount: 50,
      resourceCount: 8,
      shelterCount: 3,
    });

    const validation = validateScenario(scenario);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('can generate large scale 500-requests / 30-resources scenario quickly and validly', () => {
    const startTime = Date.now();
    const scenario = generateScenario({
      seed: 2026,
      requestCount: 500,
      resourceCount: 30,
      shelterCount: 6,
    });
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(1000); // Should take < 1 second
    expect(scenario.requests).toHaveLength(500);
    expect(scenario.resources).toHaveLength(30);

    const validation = validateScenario(scenario);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
