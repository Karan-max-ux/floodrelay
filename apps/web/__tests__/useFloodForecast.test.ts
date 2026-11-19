import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import type { FloodForecastContext } from '@floodrelay/shared';
import { useFloodForecast } from '../hooks/useFloodForecast';
import { apiClient } from '../lib/api/client';

// Configure React act environment for testing
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockDocument = {
  hidden: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag = 'div') => ({
    tagName: tag.toUpperCase(),
    nodeType: 1,
    style: {},
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    ownerDocument: mockDocument,
  }),
  createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
  documentElement: { style: {} },
  defaultView: null as unknown,
};

const mockWindow = {
  addEventListener: () => {},
  removeEventListener: () => {},
  HTMLIFrameElement: class HTMLIFrameElement {},
  document: mockDocument,
  ownerDocument: mockDocument,
};
mockDocument.defaultView = mockWindow;

global.window = mockWindow as unknown as Window & typeof globalThis;
global.document = mockDocument as unknown as Document;
if (!global.navigator) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node' },
    configurable: true,
  });
}

function renderHook<T>(hookFn: () => T) {
  const result: { current: T } = {
    current: undefined as unknown as T,
  };

  function TestHookComponent() {
    result.current = hookFn();
    return null;
  }

  const container = mockDocument.createElement('div');
  const root = ReactDOM.createRoot(container as unknown as HTMLElement);

  act(() => {
    root.render(React.createElement(TestHookComponent));
  });

  return {
    result,
    rerender: () => {
      act(() => {
        root.render(React.createElement(TestHookComponent));
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe('useFloodForecast React Hook Lifecycle & State Transitions', () => {
  const sampleContext: FloodForecastContext = {
    provider: 'Copernicus EMS GloFAS via Open-Meteo',
    source: 'ECMWF GloFAS 4.0 Gridded Hydrological Model',
    attribution: 'Copernicus EMS (CC BY 4.0)',
    license: 'CC BY 4.0',
    region: {
      name: 'Yamuna River Basin (Delhi Reach)',
      targetLat: 28.65,
      targetLng: 77.23,
      stationLat: 28.675,
      stationLng: 77.225,
    },
    issuedAt: '2026-11-08T00:00:00.000Z',
    retrievedAt: '2026-11-08T06:00:00.000Z',
    validFrom: '2026-11-08T00:00:00.000Z',
    validTo: '2026-11-14T23:59:59.000Z',
    forecastHorizonDays: 7,
    variable: {
      name: 'river_discharge',
      unit: 'm³/s',
      description: 'Simulated daily river discharge rate',
    },
    daily: [
      {
        date: '2026-11-08',
        dischargeM3S: 4.25,
        dischargeMeanM3S: 4.25,
        dischargeMaxM3S: 4.25,
        dischargeMinM3S: 4.25,
      },
    ],
    currentDischargeM3S: 4.25,
    peakForecastM3S: 4.25,
    riskCategory: 'NORMAL',
    isExperimentalIndicator: true,
    freshness: 'FRESH',
    disclaimer: 'Informational hydrological context.',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. begins with INITIAL_LOADING and transitions to READY when fresh data arrives', async () => {
    vi.spyOn(apiClient, 'getFloodForecast').mockResolvedValueOnce(sampleContext);

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast({ lat: 28.65, lng: 77.23 }));
    });

    expect(rendered!.result.current.status).toBe('INITIAL_LOADING');

    // Wait for resolution
    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered!.result.current.status).toBe('READY');
    expect(rendered!.result.current.isFresh).toBe(true);
    expect(rendered!.result.current.data?.daily).toHaveLength(1);
    expect(rendered!.result.current.error).toBeNull();
    rendered!.unmount();
  });

  it('2. maps STALE freshness to STALE status', async () => {
    vi.spyOn(apiClient, 'getFloodForecast').mockResolvedValueOnce({
      ...sampleContext,
      freshness: 'STALE',
    });

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast());
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered!.result.current.status).toBe('STALE');
    expect(rendered!.result.current.isFresh).toBe(false);
    rendered!.unmount();
  });

  it('3. maps UNAVAILABLE freshness to UNAVAILABLE status', async () => {
    vi.spyOn(apiClient, 'getFloodForecast').mockResolvedValueOnce({
      ...sampleContext,
      freshness: 'UNAVAILABLE',
      riskCategory: 'UNAVAILABLE',
      daily: [],
    });

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast());
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered!.result.current.status).toBe('UNAVAILABLE');
    expect(rendered!.result.current.isUnavailable).toBe(true);
    expect(rendered!.result.current.isFresh).toBe(false);
    rendered!.unmount();
  });

  it('4. maps OFFLINE_FIXTURE freshness to OFFLINE_FIXTURE status and sets isOfflineFixture', async () => {
    vi.spyOn(apiClient, 'getFloodForecast').mockResolvedValueOnce({
      ...sampleContext,
      freshness: 'OFFLINE_FIXTURE',
      riskCategory: 'UNKNOWN',
    });

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast());
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered!.result.current.status).toBe('OFFLINE_FIXTURE');
    expect(rendered!.result.current.isOfflineFixture).toBe(true);
    expect(rendered!.result.current.isFresh).toBe(false);
    rendered!.unmount();
  });

  it('5. handles network error on initial load by transitioning to ERROR status', async () => {
    vi.spyOn(apiClient, 'getFloodForecast').mockRejectedValueOnce(
      new Error('Failed to connect to gateway'),
    );

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast());
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered!.result.current.status).toBe('ERROR');
    expect(rendered!.result.current.error).toBe('Failed to connect to gateway');
    expect(rendered!.result.current.data).toBeNull();
    rendered!.unmount();
  });

  it('6. gracefully ignores responses when unmounted before request completes', async () => {
    let resolver: (val: FloodForecastContext) => void = () => {};
    const pendingPromise = new Promise<FloodForecastContext>((resolve) => {
      resolver = resolve;
    });

    vi.spyOn(apiClient, 'getFloodForecast').mockReturnValueOnce(pendingPromise);

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast());
    });

    expect(rendered!.result.current.status).toBe('INITIAL_LOADING');

    // Unmount before completion
    rendered!.unmount();

    // Resolve now
    await act(async () => {
      resolver(sampleContext);
      await Promise.resolve();
    });

    // Verify unmount prevented state update after unmount
    expect(rendered!.result.current.status).toBe('INITIAL_LOADING');
  });

  it('7. guards against race conditions on rapid coordinate changes', async () => {
    let resolveFirst: (val: FloodForecastContext) => void = () => {};
    const firstPromise = new Promise<FloodForecastContext>((resolve) => {
      resolveFirst = resolve;
    });

    const secondContext: FloodForecastContext = {
      ...sampleContext,
      region: { ...sampleContext.region, targetLat: 28.7 },
      currentDischargeM3S: 8.5,
    };

    const spy = vi
      .spyOn(apiClient, 'getFloodForecast')
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(secondContext);

    let currentLat = 28.65;
    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;

    act(() => {
      rendered = renderHook(() => useFloodForecast({ lat: currentLat }));
    });

    // Trigger rapid change before first promise finishes
    currentLat = 28.7;
    act(() => {
      rendered!.rerender();
    });

    expect(spy).toHaveBeenCalledTimes(2);

    // Resolve first (outdated) promise
    await act(async () => {
      resolveFirst(sampleContext);
      await Promise.resolve();
    });

    // The active state must be the second query's result, not overwritten by the older one
    expect(rendered!.result.current.data?.currentDischargeM3S).toBe(8.5);
    expect(rendered!.result.current.status).toBe('READY');
    rendered!.unmount();
  });

  it('8. same-location error preserves same-location data as STALE', async () => {
    const spy = vi
      .spyOn(apiClient, 'getFloodForecast')
      .mockResolvedValueOnce(sampleContext)
      .mockRejectedValueOnce(new Error('Network temporary glitch'));

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast({ lat: 28.65, lng: 77.23 }));
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(rendered!.result.current.status).toBe('READY');

    // Trigger refresh for same location that fails
    act(() => {
      rendered!.result.current.refresh();
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Since it was the same location, fallback to STALE is preserved
    expect(rendered!.result.current.status).toBe('STALE');
    expect(rendered!.result.current.data?.currentDischargeM3S).toBe(4.25);
    expect(spy).toHaveBeenCalledTimes(2);
    rendered!.unmount();
  });

  it('9. location change from A to B: A is not represented as B forecast if B fails', async () => {
    vi.spyOn(apiClient, 'getFloodForecast')
      .mockResolvedValueOnce(sampleContext) // Location A succeeds
      .mockRejectedValueOnce(new Error('Location B server unreachable')); // Location B fails

    let currentLat = 28.65;
    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;

    act(() => {
      rendered = renderHook(() => useFloodForecast({ lat: currentLat, lng: 77.23 }));
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(rendered!.result.current.status).toBe('READY');
    expect(rendered!.result.current.data?.currentDischargeM3S).toBe(4.25);

    // Switch to Location B
    currentLat = 28.75;
    act(() => {
      rendered!.rerender();
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Critical invariant: Location A's data MUST NOT be retained or shown as STALE for Location B!
    expect(rendered!.result.current.status).toBe('ERROR');
    expect(rendered!.result.current.data).toBeNull();
    expect(rendered!.result.current.error).toBe('Location B server unreachable');
    rendered!.unmount();
  });

  it('10. handles multiple rapid refreshes cleanly without crashing or corrupting state', async () => {
    vi.spyOn(apiClient, 'getFloodForecast').mockResolvedValue(sampleContext);

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast({ lat: 28.65 }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Rapid successive manual refreshes
    act(() => {
      rendered!.result.current.refresh(true);
      rendered!.result.current.refresh(true);
      rendered!.result.current.refresh(true);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered!.result.current.status).toBe('READY');
    expect(rendered!.result.current.error).toBeNull();
    rendered!.unmount();
  });

  it('11. UNAVAILABLE is never represented as normal risk', async () => {
    vi.spyOn(apiClient, 'getFloodForecast').mockResolvedValueOnce({
      ...sampleContext,
      freshness: 'UNAVAILABLE',
      riskCategory: 'UNAVAILABLE',
      currentDischargeM3S: 0,
      daily: [],
    });

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast());
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered!.result.current.status).toBe('UNAVAILABLE');
    expect(rendered!.result.current.isUnavailable).toBe(true);
    expect(rendered!.result.current.data?.riskCategory).toBe('UNAVAILABLE');
    expect(rendered!.result.current.data?.riskCategory).not.toBe('NORMAL');
    rendered!.unmount();
  });

  it('12. recovery from network error updates state to READY', async () => {
    vi.spyOn(apiClient, 'getFloodForecast')
      .mockRejectedValueOnce(new Error('Network glitch'))
      .mockResolvedValueOnce(sampleContext);

    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;
    act(() => {
      rendered = renderHook(() => useFloodForecast());
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(rendered!.result.current.status).toBe('ERROR');

    // Trigger recovery refresh
    act(() => {
      rendered!.result.current.refresh();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered!.result.current.status).toBe('READY');
    expect(rendered!.result.current.data?.currentDischargeM3S).toBe(4.25);
    expect(rendered!.result.current.error).toBeNull();
    rendered!.unmount();
  });

  it('13. changing forecast horizon days invalidates incompatible previous cached data', async () => {
    const horizon7 = { ...sampleContext, forecastHorizonDays: 7 };
    const horizon14 = { ...sampleContext, forecastHorizonDays: 14 };

    vi.spyOn(apiClient, 'getFloodForecast')
      .mockResolvedValueOnce(horizon7)
      .mockResolvedValueOnce(horizon14);

    let days = 7;
    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useFloodForecast>>>;

    act(() => {
      rendered = renderHook(() => useFloodForecast({ days }));
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(rendered!.result.current.data?.forecastHorizonDays).toBe(7);

    // Change horizon to 14
    days = 14;
    act(() => {
      rendered!.rerender();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(rendered!.result.current.data?.forecastHorizonDays).toBe(14);
    rendered!.unmount();
  });
});
