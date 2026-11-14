import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { useLivePolling, type UseLivePollingResult } from '../hooks/useLivePolling';
import { ApiClientError } from '../lib/api/errors';

// Configure React act environment for testing
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock window and document environment for React DOM execution in node
interface MockListeners {
  visibilitychange?: (e: Event) => void;
}
const listeners: MockListeners = {};

const mockDocument = {
  hidden: false,
  visibilityState: 'visible' as DocumentVisibilityState,
  addEventListener: (type: string, fn: (e: Event) => void) => {
    if (type === 'visibilitychange') listeners.visibilitychange = fn;
  },
  removeEventListener: (type: string) => {
    if (type === 'visibilitychange') delete listeners.visibilitychange;
  },
  createElement: (tag: string) => ({
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

function renderHook<T>(hookFn: () => UseLivePollingResult<T>) {
  const result: { current: UseLivePollingResult<T> } = {
    current: undefined as unknown as UseLivePollingResult<T>,
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
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe('Phase 5 Part 3 — Actual React useLivePolling Hook Lifecycle Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDocument.hidden = false;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it('1. performs initial fetch and sets UP_TO_DATE on success without restarting', async () => {
    const fetcher = vi.fn().mockResolvedValue(['res-1', 'res-2']);

    let renderedHook: ReturnType<typeof renderHook<string[]>>;
    act(() => {
      renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 20000 }));
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(renderedHook!.result.current.status).toBe('INITIAL_LOADING');

    // Flush resolved promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(renderedHook!.result.current.status).toBe('UP_TO_DATE');
    expect(renderedHook!.result.current.data).toEqual(['res-1', 'res-2']);
    // Verified: changing status to UP_TO_DATE does NOT call fetcher again
    expect(fetcher).toHaveBeenCalledTimes(1);

    renderedHook!.unmount();
  });

  it('2. triggers automatic refresh when poll interval elapses', async () => {
    const fetcher = vi.fn().mockResolvedValue(['tick-data']);
    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 15000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Fast-forward by interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    renderedHook.unmount();
  });

  it('3. safely unmounts, stops timer and aborts in-flight request', async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetcher = vi.fn().mockImplementation((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves
    });

    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 10000 }));
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // Unmount hook
    renderedHook.unmount();
    expect(capturedSignal!.aborted).toBe(true);

    // Ensure timer does not fire post-unmount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('4. pauses polling when tab is hidden and resumes on foreground', async () => {
    const fetcher = vi.fn().mockResolvedValue(['visible-data']);
    const renderedHook = renderHook(() =>
      useLivePolling(fetcher, { intervalMs: 10000, pauseWhenHidden: true }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Hide document tab
    mockDocument.hidden = true;
    act(() => {
      listeners.visibilitychange?.(new Event('visibilitychange'));
    });

    // Advance timers while hidden: should NOT poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Resume tab to visible: triggers immediate refresh
    mockDocument.hidden = false;
    await act(async () => {
      listeners.visibilitychange?.(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    renderedHook.unmount();
  });

  it('5. manual refresh cancels in-flight and fetches immediately', async () => {
    const fetcher = vi.fn().mockResolvedValue(['manual-data']);
    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 20000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Trigger manual refresh
    await act(async () => {
      await renderedHook.result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    renderedHook.unmount();
  });

  it('6. preserves last valid data on temporary failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(['good-data'])
      .mockRejectedValueOnce(new Error('Network glitch'));

    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 10000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renderedHook.result.current.data).toEqual(['good-data']);
    expect(renderedHook.result.current.status).toBe('UP_TO_DATE');

    // Trigger second poll that fails
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    // Data must remain intact; status becomes STALE
    expect(renderedHook.result.current.data).toEqual(['good-data']);
    expect(renderedHook.result.current.status).toBe('STALE');
    expect(renderedHook.result.current.error?.message).toBe('Network glitch');

    renderedHook.unmount();
  });

  it('7. terminates polling on HTTP 401 UNAUTHORIZED', async () => {
    const unauthorizedError = new ApiClientError({
      message: 'Session expired',
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
    const fetcher = vi.fn().mockRejectedValue(unauthorizedError);

    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 10000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renderedHook.result.current.status).toBe('UNAUTHORIZED');

    // Advance time: polling MUST NOT restart
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    renderedHook.unmount();
  });

  it('8. terminates polling on HTTP 403 FORBIDDEN', async () => {
    const forbiddenError = new ApiClientError({
      message: 'Access denied',
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    const fetcher = vi.fn().mockRejectedValue(forbiddenError);

    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 10000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renderedHook.result.current.status).toBe('FORBIDDEN');

    // Advance time: polling MUST NOT restart
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    renderedHook.unmount();
  });

  it('9. applies bounded exponential backoff on repeated failures', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Persistent error'));
    const renderedHook = renderHook(() =>
      useLivePolling(fetcher, { intervalMs: 10000, maxBackoffMs: 25000 }),
    );

    // Initial poll fails -> delay becomes min(10000 * 1.5, 25000) = 15000
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 10s: should NOT have polled yet because backoff is 15s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 15s total: fires second poll -> delay becomes min(15000 * 1.5, 25000) = 22500
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    renderedHook.unmount();
  });

  it('10. ignores AbortError on cancellation without marking error or setting offline/stale status', async () => {
    const onError = vi.fn();
    const fetcher = vi.fn().mockImplementation((signal: AbortSignal) => {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('signal is aborted without reason', 'AbortError'));
        });
      });
    });

    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 10000, onError }));

    // Unmount while request is in flight
    renderedHook.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(renderedHook.result.current.error).toBeNull();
  });

  it('11. cancels in-flight poll on manual refresh and cleanly adopts fresh result', async () => {
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation((signal: AbortSignal) => {
      callCount++;
      const currentCall = callCount;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('signal is aborted without reason', 'AbortError'));
        });
        if (currentCall === 2) {
          resolve(['fresh-data']);
        }
      });
    });

    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 10000 }));

    // Trigger manual refresh while initial poll is still pending
    await act(async () => {
      await renderedHook.result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(renderedHook.result.current.data).toEqual(['fresh-data']);
    expect(renderedHook.result.current.status).toBe('UP_TO_DATE');
    expect(renderedHook.result.current.error).toBeNull();

    renderedHook.unmount();
  });

  it('12. handles React Strict Mode mount -> unmount -> remount lifecycle safely', async () => {
    const onError = vi.fn();
    const fetcher = vi.fn().mockImplementation((signal: AbortSignal) => {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('signal is aborted without reason', 'AbortError'));
        });
        setTimeout(() => {
          if (!signal.aborted) resolve(['strict-mode-data']);
        }, 50);
      });
    });

    // Simulating React Strict Mode: mount 1
    const hook1 = renderHook(() => useLivePolling(fetcher, { intervalMs: 10000, onError }));
    // Immediate unmount
    hook1.unmount();

    // Immediate remount
    const hook2 = renderHook(() => useLivePolling(fetcher, { intervalMs: 10000, onError }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(hook2.result.current.data).toEqual(['strict-mode-data']);
    expect(hook2.result.current.status).toBe('UP_TO_DATE');
    expect(hook2.result.current.error).toBeNull();

    hook2.unmount();
  });

  it('13. ensures subsequent polling succeeds after an aborted initial cycle', async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce((signal: AbortSignal) => {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('signal is aborted without reason', 'AbortError'));
          });
        });
      })
      .mockResolvedValueOnce(['subsequent-success']);

    const renderedHook = renderHook(() => useLivePolling(fetcher, { intervalMs: 5000 }));

    // Abort initial cycle via manual refresh
    await act(async () => {
      await renderedHook.result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(renderedHook.result.current.data).toEqual(['subsequent-success']);
    expect(renderedHook.result.current.status).toBe('UP_TO_DATE');
    expect(renderedHook.result.current.error).toBeNull();

    renderedHook.unmount();
  });
});
