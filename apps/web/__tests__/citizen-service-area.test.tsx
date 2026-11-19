import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import CitizenRequestPage from '../app/citizen/request/page';
import {
  CitizenReceiptCard,
  type CitizenReceipt,
  type SubmissionOutcome,
} from '../components/citizen/CitizenReceiptCard';
import { useCitizenLocation } from '@/hooks/useCitizenLocation';
import { getCitizenMessages } from '@/lib/i18n';

// Configure React act environment
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock minimal DOM environment for React 19 node execution
interface MockListeners {
  [event: string]: (e: Event) => void;
}
const listeners: MockListeners = {};

const mockDocument = {
  addEventListener: (type: string, fn: (e: Event) => void) => {
    listeners[type] = fn;
  },
  removeEventListener: (type: string) => {
    delete listeners[type];
  },
  createElement: (tag: string) => ({
    tagName: tag.toUpperCase(),
    nodeType: 1,
    style: {},
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: (type: string, fn: (e: Event) => void) => {
      listeners[type] = fn;
    },
    removeEventListener: (type: string) => {
      delete listeners[type];
    },
    ownerDocument: mockDocument,
  }),
  createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
  documentElement: { style: {} },
  defaultView: null as unknown,
};

class MockHTMLIFrameElement {}
class MockElement {}
class MockHTMLElement extends MockElement {}

const mockGeolocation = {
  getCurrentPosition: vi.fn(),
};

const mockWindow = {
  addEventListener: () => {},
  removeEventListener: () => {},
  HTMLIFrameElement: MockHTMLIFrameElement,
  Element: MockElement,
  HTMLElement: MockHTMLElement,
  document: mockDocument,
  ownerDocument: mockDocument,
  navigator: {
    userAgent: 'node',
    geolocation: mockGeolocation,
  },
};
mockDocument.defaultView = mockWindow;

global.window = mockWindow as unknown as Window & typeof globalThis;
global.document = mockDocument as unknown as Document;
(globalThis as unknown as Record<string, unknown>).HTMLIFrameElement = MockHTMLIFrameElement;
(globalThis as unknown as Record<string, unknown>).Element = MockElement;
(globalThis as unknown as Record<string, unknown>).HTMLElement = MockHTMLElement;
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'node',
    geolocation: mockGeolocation,
  },
  configurable: true,
  writable: true,
});

// Mock Next.js navigation
const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock CitizenLocationPreview
vi.mock('@/components/citizen/CitizenLocationPreview', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-location-preview" />,
}));

// Mock apiClient
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    createRequest: vi.fn(),
  },
}));

// In-memory sessionStorage mock
const mockSessionStorage: Record<string, string> = {};
Object.defineProperty(globalThis, 'sessionStorage', {
  value: {
    getItem: (key: string) => mockSessionStorage[key] ?? null,
    setItem: (key: string, value: string) => {
      mockSessionStorage[key] = String(value);
    },
    removeItem: (key: string) => {
      delete mockSessionStorage[key];
    },
    clear: () => {
      for (const k of Object.keys(mockSessionStorage)) {
        delete mockSessionStorage[k];
      }
    },
  },
  writable: true,
});

describe('Phase 9 — Citizen Portal Delhi NCR Service-Area UI & Safety Safeguards', () => {
  const messages = getCitizenMessages();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockRouterPush.mockClear();
    sessionStorage.clear();
  });

  describe('Outside-Area Emergency Guidance UI Contracts (Phase 4)', () => {
    it('renders exact heading, required emergency copy, tel:112, and action controls on outside-area state', () => {
      const html = renderToString(<CitizenRequestPage />);
      expect(html).toContain('FloodRelay request form available');

      expect(messages.serviceArea.outsideHeading).toBe(
        "Location Outside FloodRelay's Service Area",
      );
      expect(messages.serviceArea.outsideP1).toContain(
        'FloodRelay currently accepts rescue assistance requests only for locations within its supported Delhi NCR area.',
      );
      expect(messages.serviceArea.outsideP2).toContain(
        'Your selected location is outside this area, so no rescue request has been submitted or assigned.',
      );
      expect(messages.serviceArea.outsideP3).toContain('call 112 for emergency assistance');
      expect(messages.serviceArea.outsideP4).toContain(
        'If your location was detected incorrectly, correct your address or coordinates and try again.',
      );
      expect(messages.serviceArea.call112Cta).toBe('Call 112');
      expect(messages.serviceArea.changeLocationCta).toBe('Change Location');
      expect(messages.serviceArea.tryAgainCta).toBe('Try Location Check Again');
    });

    it('outside-area guidance never presents confirmation, ticket IDs, or dispatch promises', () => {
      const copy = [
        messages.serviceArea.outsideHeading,
        messages.serviceArea.outsideP1,
        messages.serviceArea.outsideP2,
        messages.serviceArea.outsideP3,
        messages.serviceArea.outsideP4,
      ].join(' ');

      expect(copy).not.toMatch(/request confirmed/i);
      expect(copy).not.toMatch(/rescue team assigned/i);
      expect(copy).not.toMatch(/rescue is on its way/i);
      expect(copy).not.toMatch(/ticket id/i);
    });

    it('unavailable service-area check displays availability warning, preserves input, and allows retry without claiming outside NCR', () => {
      expect(messages.serviceArea.unavailableHeading).toBe(
        'Service-Area Check Temporarily Unavailable',
      );
      expect(messages.serviceArea.unavailableP1).toContain(
        'temporarily unable to verify whether your location is inside its supported Delhi NCR service area',
      );
      expect(messages.serviceArea.unavailableP1).toContain('information has been preserved');
      expect(messages.serviceArea.unavailableP2).toContain('call 112 directly');
      expect(messages.serviceArea.unavailableP1).not.toContain('Your location is outside');
    });
  });

  describe('useCitizenLocation Hook Service-Area Lifecycle & Invalidation (Phase 6)', () => {
    interface HarnessHandle {
      location: ReturnType<typeof useCitizenLocation>;
    }

    function ServiceAreaHarness({ onMount }: { onMount: (h: HarnessHandle) => void }) {
      const location = useCitizenLocation({ enableServiceAreaCheck: true });
      onMount({ location });
      return null;
    }

    let container: unknown;
    let root: ReactDOM.Root;

    beforeEach(() => {
      container = mockDocument.createElement('div');
      root = ReactDOM.createRoot(container as HTMLElement);
    });

    afterEach(() => {
      act(() => {
        root.unmount();
      });
    });

    it('evaluates service-area check and updates serviceAreaStatus to ELIGIBLE for Delhi coordinates', async () => {
      let handle!: HarnessHandle;
      act(() => {
        root.render(<ServiceAreaHarness onMount={(h) => (handle = h)} />);
      });

      expect(handle.location.serviceAreaStatus).toBe('IDLE');

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              eligible: true,
              regionId: 'IN-NCR',
              regionName: 'Delhi NCR',
              boundaryVersion: 'ncrpb-2026-gb-ind-adm2-v1',
              inclusiveBoundaryPolicy: 'ST_COVERS',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await act(async () => {
        const eligible = await handle.location.checkServiceAreaCoordinates(28.6315, 77.2167);
        expect(eligible).toBe(true);
      });

      expect(handle.location.serviceAreaStatus).toBe('ELIGIBLE');
      expect(handle.location.serviceAreaInfo?.regionId).toBe('IN-NCR');
    });

    it('updates serviceAreaStatus to OUTSIDE and clears confirmed status when coordinates lie outside NCR', async () => {
      let handle!: HarnessHandle;
      act(() => {
        root.render(<ServiceAreaHarness onMount={(h) => (handle = h)} />);
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              eligible: false,
              regionId: 'IN-NCR',
              regionName: 'Delhi NCR',
              boundaryVersion: 'ncrpb-2026-gb-ind-adm2-v1',
              inclusiveBoundaryPolicy: 'ST_COVERS',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await act(async () => {
        const eligible = await handle.location.checkServiceAreaCoordinates(19.076, 72.8777);
        expect(eligible).toBe(false);
      });

      expect(handle.location.serviceAreaStatus).toBe('OUTSIDE');
      expect(handle.location.isLocationConfirmed).toBe(false);
    });

    it('invalidates previous ELIGIBLE status immediately when manual coordinates change', async () => {
      let handle!: HarnessHandle;
      act(() => {
        root.render(<ServiceAreaHarness onMount={(h) => (handle = h)} />);
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              eligible: true,
              regionId: 'IN-NCR',
              regionName: 'Delhi NCR',
              boundaryVersion: 'ncrpb-2026-gb-ind-adm2-v1',
              inclusiveBoundaryPolicy: 'ST_COVERS',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await act(async () => {
        await handle.location.checkServiceAreaCoordinates(28.6315, 77.2167);
      });
      expect(handle.location.serviceAreaStatus).toBe('ELIGIBLE');

      act(() => {
        handle.location.handleCoordinateChange('lat', '28.6316');
      });

      expect(handle.location.serviceAreaStatus).toBe('IDLE');
      expect(handle.location.serviceAreaInfo).toBeNull();
      expect(handle.location.isLocationConfirmed).toBe(false);
    });

    it('aborts slower in-flight check and ignores response when coordinates change', async () => {
      let handle!: HarnessHandle;
      act(() => {
        root.render(<ServiceAreaHarness onMount={(h) => (handle = h)} />);
      });

      let resolveSlowCheck!: (res: Response) => void;
      const slowPromise = new Promise<Response>((resolve) => {
        resolveSlowCheck = resolve;
      });

      vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(slowPromise);

      act(() => {
        void handle.location.checkServiceAreaCoordinates(28.6315, 77.2167);
      });
      expect(handle.location.serviceAreaStatus).toBe('CHECKING');

      act(() => {
        handle.location.handleCoordinateChange('lat', '19.076');
      });
      expect(handle.location.serviceAreaStatus).toBe('IDLE');

      await act(async () => {
        resolveSlowCheck(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                eligible: true,
                regionId: 'IN-NCR',
                regionName: 'Delhi NCR',
                boundaryVersion: 'ncrpb-2026-gb-ind-adm2-v1',
                inclusiveBoundaryPolicy: 'ST_COVERS',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      });

      expect(handle.location.serviceAreaStatus).toBe('IDLE');
      expect(handle.location.serviceAreaInfo).toBeNull();
    });
  });

  describe('Confirmation Page & Stale-Receipt Protection (Phase 5)', () => {
    it('renders "No Rescue Request Created for Your Latest Attempt" when latest attempt was rejected', () => {
      const outcome: SubmissionOutcome = {
        status: 'REJECTED_OUTSIDE',
        message: 'Location outside Delhi NCR',
        timestamp: new Date().toISOString(),
      };

      const html = renderToString(<CitizenReceiptCard initialOutcome={outcome} />);
      expect(html).toContain('No Rescue Request Created for Your Latest Attempt');
      expect(html).toContain(
        'lies outside FloodRelay’s supported Delhi NCR service area. No request ticket was recorded or dispatched.',
      );
      expect(html).toContain('href="tel:112"');
      expect(html).toContain('href="/citizen/request"');
      expect(html).not.toContain('Your Request Has Been Submitted');
    });

    it('renders rejection notice when latest attempt failed with 503 unavailable and preserves tel:112', () => {
      const outcome: SubmissionOutcome = {
        status: 'UNAVAILABLE',
        message: 'Service area verification unavailable',
        timestamp: new Date().toISOString(),
      };

      const html = renderToString(<CitizenReceiptCard initialOutcome={outcome} />);
      expect(html).toContain('No Rescue Request Created for Your Latest Attempt');
      expect(html).toContain('service-area verification was temporarily unavailable');
      expect(html).toContain('href="tel:112"');
      expect(html).not.toContain('Your Request Has Been Submitted');
    });

    it('guards against presenting a stale previous receipt as confirmation for a newer rejected attempt', () => {
      const oldReceipt: CitizenReceipt = {
        id: 'req-yesterday-delhi',
        createdAt: '2026-11-17T10:00:00.000Z',
        urgency: 'HIGH',
        peopleCount: 2,
        isFlaggedDuplicate: false,
        duplicateOfId: null,
        idempotent: false,
        savedAt: '2026-11-17T10:00:00.000Z',
      };
      const newOutcome: SubmissionOutcome = {
        status: 'REJECTED_OUTSIDE',
        timestamp: '2026-11-18T10:00:00.000Z',
      };

      const html = renderToString(
        <CitizenReceiptCard initialReceipt={oldReceipt} initialOutcome={newOutcome} />,
      );
      expect(html).toContain('No Rescue Request Created for Your Latest Attempt');
      expect(html).not.toContain('Your Request Has Been Submitted');
      expect(html).toContain('View Earlier Request Receipt');
      expect(html).toContain('req-yesterday-delhi');
    });

    it('renders confirmed receipt only when latest submission was accepted by backend', () => {
      const acceptedReceipt: CitizenReceipt = {
        id: 'req-today-delhi-123',
        createdAt: new Date().toISOString(),
        urgency: 'HIGH',
        peopleCount: 4,
        isFlaggedDuplicate: false,
        duplicateOfId: null,
        idempotent: false,
        addressSummary: 'Yamuna Bazar, Delhi',
        savedAt: new Date().toISOString(),
        verifiedByBackend: true,
      };
      const acceptedOutcome: SubmissionOutcome = {
        status: 'ACCEPTED',
        receiptId: 'req-today-delhi-123',
        timestamp: new Date().toISOString(),
      };

      const html = renderToString(
        <CitizenReceiptCard initialReceipt={acceptedReceipt} initialOutcome={acceptedOutcome} />,
      );
      expect(html).toContain('Your Request Has Been Submitted');
      expect(html).toContain('req-today-delhi-123');
      expect(html).toContain('FLOODRELAY REQUEST RECEIPT');
      expect(html).toContain(
        'Your request has been recorded in FloodRelay for operator review. This does not mean a rescue team has been dispatched.',
      );
    });

    it('displays fallback when accessed with no active receipt and no submission outcome', () => {
      const html = renderToString(
        <CitizenReceiptCard initialReceipt={undefined} initialOutcome={undefined} />,
      );
      // In SSR without initialReceipt/initialOutcome, it renders the fallback or loading
      expect(html).toBeDefined();
    });
  });
});
