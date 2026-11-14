# FloodRelay — Delhi regionalisation (initial milestone)

FloodRelay currently defaults its **user-facing experience** to Delhi NCR and
Indian English (`en-IN`). Region settings and `Asia/Kolkata` formatting are
centralised in `apps/web/lib/region.ts`. These settings do **not** restrict
API latitude/longitude, alter routing algorithms, change PostgreSQL time storage,
or assert the presence of real rescue resources or shelters.

## Truthful emergency messaging

- India's national emergency number is **112** (Emergency Response Support System,
  Ministry of Home Affairs): https://www.mha.gov.in/emergency-response-support-system-erss
- FloodRelay is an independent decision-support **prototype**, not an official
  government emergency dispatch channel. Web request submission does not confirm
  that a physical rescue team has been contacted or deployed.
- Demo geography and simulated assets must remain explicitly identified as
  synthetic. Existing REAL/SIMULATED/MIXED safeguards remain unchanged.

## Included in this milestone

- Delhi terminology in the Citizen and Operator landing screens and login.
- Indian English strings and national emergency guidance in key citizen flows.
- Deterministic Indian date/time presentation for key requests, audits, status
  indicators and assignment details; no changes to API timestamp formats.
- Regression tests for regional display helpers.

## Subsequent milestones (not included here)

- Audit every remaining status card and map overlay for Delhi-specific labels.
- Validate Delhi fixture coordinates, road restrictions, reference locations,
  and map centre/bounds independently; never represent fixtures as live incidents.
- Introduce fully translated and reviewed Hindi (`hi-IN`) citizen messaging.
- Verify further helplines, field operations, and any shelter network before
  publication. No unsupported real-time water gauge claims.
