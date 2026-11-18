# FloodRelay — Faculty & Evaluator Presentation Script (5–10 Minutes)

This script provides an exact spoken narrative for demonstrating FloodRelay during faculty evaluation, oral defenses, or technical presentations.

---

## Slide / Screen 1: Introduction & Problem Context (1 Minute)

> **Speaker:**  
> "Good morning, evaluators. During major urban flood emergencies—such as the monsoon inundations along the Yamuna River basin in Delhi—coordinating emergency evacuations is exceptionally high-stakes.
>
> Emergency Operation Centers face three core challenges:
>
> 1. Citizen distress calls flood in by the thousands with high rates of duplication.
> 2. Traditional route optimization algorithms assume static road conditions, but floodwaters constantly submerge roads and disable rescue crafts.
> 3. Arbitrary re-optimization causes operational chaos if vehicle crews already executing a rescue have their orders abruptly scrambled.
>
> FloodRelay is an operational decision-support platform designed to address these exact challenges."

---

## Screen 2: Citizen Distress Intake & Duplicate Triage (2 Minutes)

_(Open [http://localhost:3000/citizen/request](http://localhost:3000/citizen/request) on left and [http://localhost:3000/operator](http://localhost:3000/operator) on right)_

> **Speaker:**  
> "First, let's look at public citizen intake. Stranded residents submit distress calls with location coordinates, group size, urgency, and medical flags.
>
> Let's look at what happens in the Operator Portal when multiple calls originate from the same location.
>
> Here, `demo-req-002` was submitted within 30 meters of `demo-req-001`. Notice that FloodRelay immediately flags this as a spatial duplicate with an explicit visual warning badge.
>
> But crucially, look at our architectural rule: **FloodRelay never deletes or silently discards duplicate requests.** An automatic duplicate flag is a triage indicator, not an authorization to discard. The human dispatcher retains full review authority to ensure distinct neighboring families are not abandoned."

---

## Screen 3: Algorithmic Routing with Human Commitment (2 Minutes)

_(Navigate to Assignments -> Propose -> Commit)_

> **Speaker:**  
> "Next is resource allocation. FloodRelay employs multi-vehicle heuristics—including Clarke-Wright savings and cluster allocation—to route rescue boats and high-water trucks.
>
> Notice that when the solver generates a route, it is labeled strictly as **PROPOSED**.
>
> We enforce human-in-the-loop decision support: the system proposes, but an authorized human operator commits.
>
> For our synthetic demonstration scenario, FloodRelay operates in **Simulation Preview Mode**, retaining the plan in `PROPOSED` status to prevent synthetic test data from leaking into live dispatch (per ADR-41).
>
> In real disaster operations with verified citizen requests, when the operator commits the plan:
>
> 1. The assignment status moves to `COMMITTED`.
> 2. All mission stops are marked **`is_frozen = true`**.
>
> In disaster operations, once a boat is dispatched to a terrace rescue, that stop represents an active in-flight commitment."

---

## Screen 4: Dynamic Disruption & Incremental Repair (3 Minutes)

_(Navigate to Tactical Map [http://localhost:3000/operator/map](http://localhost:3000/operator/map))_

> **Speaker:**  
> "Now consider real-world operational disruptions. During an active flood, conditions change rapidly:
>
> - A rescue craft suffers an outboard motor failure in turbid debris.
> - A key underpass on Ring Road becomes submerged.
>
> I will now update `demo-res-boat-01` to `OFFLINE` and register the submerged road hazard.
>
> In legacy systems, re-running a global optimizer would wipe the slate clean and reassign all crafts, disrupting ongoing rescues.
>
> In FloodRelay, our **Incremental Repair Solver** re-optimizes the disrupted demand while guaranteeing that all in-flight committed stops remain strictly frozen.
>
> Notice the churn metrics on screen:
>
> - **Frozen Stops Violated:** `0`.
> - **Reassigned Requests:** Only the unserved pickups from the disabled craft are re-allocated.
> - **Route Churn Score:** Kept to the minimal feasible deviation."

---

## Screen 5: GIS Hydrological Context & Auditability (1–2 Minutes)

_(Toggle River Flood Forecast layer ON, then open [http://localhost:3000/operator/audit](http://localhost:3000/operator/audit))_

> **Speaker:**  
> "Finally, let's examine environmental intelligence and system accountability.
>
> On the tactical map, dispatchers can toggle the **GloFAS River Flood Forecast layer**, providing gridded daily river discharge forecasts from ECMWF for the Yamuna corridor.
>
> Notice our governance policy: this hydrological layer is strictly informational. It informs situational awareness, but never triggers autonomous dispatch or route tampering.
>
> Every action we took today—from citizen submission to route commitment, disruption recording, and repair orchestration—is recorded in the immutable operational audit trail with role-based redaction of sensitive citizen data.
>
> In summary, FloodRelay bridges algorithmic intelligence with human operational oversight, enabling reliable, verifiable, and resilient flood rescue coordination.
>
> Thank you. I welcome your questions."
