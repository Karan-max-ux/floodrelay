import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Operational Limitations & System Boundaries — FloodRelay',
  description:
    'Public disclosure of technical uncertainty, algorithmic boundaries, and human-supervised operational scope for the FloodRelay decision-support system.',
};

export default function LimitationsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA] text-slate-800 font-sans selection:bg-blue-100 selection:text-[#0A2540]">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-[#0A2540] text-white border-b border-slate-700/60 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link
            href="/citizen"
            className="flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400 rounded p-1 transition-opacity hover:opacity-90"
            aria-label="FloodRelay Home"
          >
            <div className="w-8 h-8 rounded bg-[#0066CC] flex items-center justify-center text-white">
              <span className="material-symbols-outlined text-[20px]" data-icon="water_damage">
                water_damage
              </span>
            </div>
            <div>
              <span className="font-manrope text-lg font-bold tracking-tight text-white leading-none block">
                FloodRelay
              </span>
              <span className="text-[10px] tracking-wider uppercase text-blue-200 font-semibold font-mono block">
                Safety & Operations
              </span>
            </div>
          </Link>

          <nav
            aria-label="Portal Navigation"
            className="flex items-center gap-4 text-xs font-medium"
          >
            <Link
              href="/citizen"
              className="text-slate-200 hover:text-white transition-colors px-2.5 py-1.5 rounded hover:bg-white/10"
            >
              Citizen Portal
            </Link>
            <Link
              href="/citizen/request"
              className="text-slate-200 hover:text-white transition-colors px-2.5 py-1.5 rounded hover:bg-white/10 hidden sm:inline-block"
            >
              Request Assistance
            </Link>
            <Link
              href="/operator/login"
              className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded transition-colors border border-white/15"
            >
              Operator Portal
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Headline Section */}
      <section className="bg-white border-b border-slate-200 py-10 md:py-14">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono font-semibold uppercase tracking-wider mb-4">
            <span className="w-2 h-2 rounded-full bg-[#0066CC]" />
            Official System Boundaries & Uncertainty Disclosure
          </div>
          <h1 className="font-manrope text-3xl md:text-4xl font-extrabold text-[#0A2540] tracking-tight mb-4">
            Operational Limitations & System Boundaries
          </h1>
          <p className="text-base md:text-lg text-slate-600 leading-relaxed">
            FloodRelay is a human-supervised decision-support platform designed to assist emergency
            coordinators in allocating flood rescue resources. This document details the technical
            boundaries, mathematical modeling assumptions, and uncertainty factors inherent in the
            platform.
          </p>

          {/* Quick Jump Navigation */}
          <nav aria-label="Document Sections" className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 font-mono">
              Jump to Section
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <a
                href="#purpose-scope"
                className="px-2.5 py-1.5 rounded bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-[#0066CC] border border-slate-200 transition-colors"
              >
                1. Purpose & Scope
              </a>
              <a
                href="#location-uncertainty"
                className="px-2.5 py-1.5 rounded bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-[#0066CC] border border-slate-200 transition-colors"
              >
                2. Location Uncertainty
              </a>
              <a
                href="#routing-uncertainty"
                className="px-2.5 py-1.5 rounded bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-[#0066CC] border border-slate-200 transition-colors"
              >
                3. Route Uncertainty
              </a>
              <a
                href="#simulated-data"
                className="px-2.5 py-1.5 rounded bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-[#0066CC] border border-slate-200 transition-colors"
              >
                4. Simulated Data
              </a>
              <a
                href="#optimization-limits"
                className="px-2.5 py-1.5 rounded bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-[#0066CC] border border-slate-200 transition-colors"
              >
                5. Optimization Limits
              </a>
              <a
                href="#human-supervision"
                className="px-2.5 py-1.5 rounded bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-[#0066CC] border border-slate-200 transition-colors"
              >
                6. Human Supervision
              </a>
              <a
                href="#operational-availability"
                className="px-2.5 py-1.5 rounded bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-[#0066CC] border border-slate-200 transition-colors"
              >
                7. Technical Availability
              </a>
              <a
                href="#emergency-safety"
                className="px-2.5 py-1.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-semibold transition-colors"
              >
                8. Emergency Safety
              </a>
            </div>
          </nav>
        </div>
      </section>

      {/* Main Content Sections */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
        {/* Urgent Emergency Callout */}
        <section
          id="emergency-safety"
          aria-labelledby="emergency-safety-heading"
          className="p-5 md:p-6 rounded-lg bg-amber-50 border-l-4 border-amber-500 text-amber-950 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <span
              className="material-symbols-outlined text-amber-700 text-2xl shrink-0 mt-0.5"
              data-icon="warning"
            >
              warning
            </span>
            <div>
              <h2 id="emergency-safety-heading" className="text-base font-bold text-amber-900 mb-1">
                Life-Threatening Emergency Notice
              </h2>
              <p className="text-sm text-amber-900 leading-relaxed">
                If you or someone near you is in immediate, life-threatening danger, do not wait for
                a web-based status change.{' '}
                <strong>Contact official local emergency services immediately</strong> (such as{' '}
                <strong>112</strong> in India, or your jurisdiction&apos;s designated national
                emergency telephone dispatch). FloodRelay coordinates support resources but does not
                supersede or replace government emergency response.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION A: Purpose and Scope */}
        <section
          id="purpose-scope"
          aria-labelledby="purpose-scope-heading"
          className="bg-white p-6 md:p-8 rounded-lg border border-slate-200 shadow-xs"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#0066CC]" data-icon="policy">
              policy
            </span>
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
              Section 1
            </span>
          </div>
          <h2
            id="purpose-scope-heading"
            className="text-xl md:text-2xl font-bold text-[#0A2540] mb-4"
          >
            Purpose & Scope of Decision Support
          </h2>
          <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <p>
              FloodRelay is designed as an <strong>operational decision-support system</strong> for
              flood evacuation triage and vehicle routing. Its primary objective is to group spatial
              demand, evaluate fleet capacity, and recommend candidate rescue schedules to trained
              human coordinators.
            </p>
            <p>
              The platform does not operate as an autonomous emergency (112) dispatch service. It
              does not control physical sirens, initiate automated public alerts, or issue binding
              military or municipal orders. All plans generated by the optimization engine remain
              strictly advisory until reviewed, verified, and explicitly authorised by an
              authenticated human operator.
            </p>
          </div>
        </section>

        {/* SECTION B: GPS and Location Uncertainty */}
        <section
          id="location-uncertainty"
          aria-labelledby="location-uncertainty-heading"
          className="bg-white p-6 md:p-8 rounded-lg border border-slate-200 shadow-xs"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#0066CC]" data-icon="my_location">
              my_location
            </span>
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
              Section 2
            </span>
          </div>
          <h2
            id="location-uncertainty-heading"
            className="text-xl md:text-2xl font-bold text-[#0A2540] mb-4"
          >
            GPS & Location Uncertainty
          </h2>
          <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <p>
              Location coordinates submitted by citizens rely on standard browser Geolocation APIs,
              which exhibit varying degrees of precision depending on cellular triangulation, Wi-Fi
              SSID positioning, and device satellite visibility:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
              <li>
                <strong>Browser GPS Variance:</strong> Urban canyoning, cloud cover, indoor
                positioning, and degraded network backhauls can cause coordinate offsets ranging
                from ±10 meters to over ±150 meters.
              </li>
              <li>
                <strong>Reverse-Geocoding Approximation:</strong> Addresses resolved through
                automated reverse geocoding (e.g., Geoapify) represent nearest road centerlines or
                parcel centroids. They do not confirm structural entry points, rooftop
                accessibility, or specific apartment units.
              </li>
              <li>
                <strong>Landmark Reliance:</strong> Coordinates should always be supplemented by
                structural landmarks, floor levels, and visible indicators (e.g., &quot;2nd floor
                balcony, green roof&quot;) to ensure air and water crews can locate occupants during
                severe flooding.
              </li>
              <li>
                <strong>Offline & Intermittent Failures:</strong> Under cellular blackout or
                satellite loss, reverse-geocoding requests will fail gracefully, requiring manual
                street address and landmark entry.
              </li>
            </ul>
          </div>
        </section>

        {/* SECTION C: Route and Travel-Time Uncertainty */}
        <section
          id="routing-uncertainty"
          aria-labelledby="routing-uncertainty-heading"
          className="bg-white p-6 md:p-8 rounded-lg border border-slate-200 shadow-xs"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#0066CC]" data-icon="alt_route">
              alt_route
            </span>
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
              Section 3
            </span>
          </div>
          <h2
            id="routing-uncertainty-heading"
            className="text-xl md:text-2xl font-bold text-[#0A2540] mb-4"
          >
            Route & Travel-Time Uncertainty
          </h2>
          <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <p>
              Travel times and transit routes are computed using Open Source Routing Machine (OSRM)
              road-network models augmented with spatial flood impedance multipliers:
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded p-4 text-xs space-y-2 font-mono">
              <div className="flex justify-between border-b border-slate-200 pb-1">
                <span className="font-semibold text-slate-700">Modeling Parameter</span>
                <span className="font-semibold text-slate-700">Baseline Multiplier / Policy</span>
              </div>
              <div className="flex justify-between">
                <span>Default Road Detour Factor</span>
                <span>1.3x geodesic haversine (uncalibrated)</span>
              </div>
              <div className="flex justify-between">
                <span>Assumed Road Vehicle Speed</span>
                <span>30 km/h (fallback uncalibrated)</span>
              </div>
              <div className="flex justify-between">
                <span>Flood Surge Impedance</span>
                <span>2.0x transit duration penalty</span>
              </div>
              <div className="flex justify-between">
                <span>Operator Blocked Zones</span>
                <span>Infinite duration (blocked leg rejection)</span>
              </div>
            </div>
            <p>
              <strong>Critical Routing Caveats:</strong>
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
              <li>
                <strong>Static OpenStreetMap Data:</strong> OSRM calculates routes across static
                network maps. It possesses no innate sensor telemetry of submerged roads, washed-out
                bridges, or fallen power lines unless an operator has explicitly circumscribed an
                active blocked zone polygon.
              </li>
              <li>
                <strong>No Live Traffic Feed:</strong> Traffic congestion, emergency vehicle
                blockages, and civilian gridlock are not captured in algorithmic duration
                calculations.
              </li>
              <li>
                <strong>Resource-Type Specific Routing:</strong> High-water trucks and ambulances
                navigate road network topologies. Air resources (helicopters) and watercraft (boats)
                utilize geodesic straight-line models with speed envelopes (20–30 km/h for boats)
                and are not bound to streets.
              </li>
              <li>
                <strong>No Certified Route Safety:</strong> A calculated route does not represent an
                inspected or certified safe passage. Responding units must exercise independent
                navigational discretion based on on-site water depth and velocity.
              </li>
            </ul>
          </div>
        </section>

        {/* SECTION D: Simulated and Reference Data Boundaries */}
        <section
          id="simulated-data"
          aria-labelledby="simulated-data-heading"
          className="bg-white p-6 md:p-8 rounded-lg border border-slate-200 shadow-xs"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#0066CC]" data-icon="science">
              science
            </span>
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
              Section 4
            </span>
          </div>
          <h2
            id="simulated-data-heading"
            className="text-xl md:text-2xl font-bold text-[#0A2540] mb-4"
          >
            Simulated & Reference Data Boundaries
          </h2>
          <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <p>
              To evaluate algorithms safely without risking public harm, development and benchmark
              suites utilize explicitly labeled synthetic datasets:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
              <li>
                <strong>Synthetic Incidents:</strong> Requests flagged as <code>SIMULATED</code> are
                produced by reproducible PRNG scenario generators. They do not represent real human
                beings or active emergency calls.
              </li>
              <li>
                <strong>Reference Fleet Specifications:</strong> Vehicles and boats in demo
                scenarios reflect nominal capacity archetypes (e.g., boat capacity: 6 persons;
                truck: 10 persons). They do not represent physical assets on standby.
              </li>
              <li>
                <strong>Hazard Polygons:</strong> Reference blocked zones represent mathematical
                test polygons rather than live telemetry from hydrological gauging stations.
              </li>
              <li>
                <strong>Provenance Auditing:</strong> The platform verifies entity provenance
                cryptographically via SHA-256 canonical JSON hashes to prevent mixing simulated
                scenarios with live operations.
              </li>
            </ul>
          </div>
        </section>

        {/* SECTION E: Optimization Limitations */}
        <section
          id="optimization-limits"
          aria-labelledby="optimization-limits-heading"
          className="bg-white p-6 md:p-8 rounded-lg border border-slate-200 shadow-xs"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#0066CC]" data-icon="calculate">
              calculate
            </span>
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
              Section 5
            </span>
          </div>
          <h2
            id="optimization-limits-heading"
            className="text-xl md:text-2xl font-bold text-[#0A2540] mb-4"
          >
            Optimization Model Limitations & Shift Constraints
          </h2>
          <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <p>
              The optimization algorithms (DBSCAN Cluster-Allocation, Nearest-First heuristic, and
              Google OR-Tools PDP baseline) operate under mathematical constraints that can leave
              requests unserved:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
              <li>
                <strong>
                  Shift Limit Exhaustion (<code>SHIFT_LIMIT_REACHED</code>):
                </strong>{' '}
                Each rescue unit enforces a strict operational shift limit (default 480 minutes / 8
                hours). Solvers mandate that both pickup transit and return-leg to safety must
                complete within this window. In dense scenarios, peripheral requests may remain
                unserved due to shift exhaustion.
              </li>
              <li>
                <strong>
                  Vehicle Capacity Ceilings (<code>GROUP_LARGER_THAN_ANY_VEHICLE</code>):
                </strong>{' '}
                If an individual family group exceeds the passenger capacity of every available
                vehicle in the fleet, it cannot be assigned to a single vehicle without manual
                operator partitioning.
              </li>
              <li>
                <strong>Mathematical vs Physical Feasibility:</strong> A mathematical tour
                calculated across coordinate space does not guarantee physical navigability,
                adequate fuel reserves, or launch ramp clearance.
              </li>
              <li>
                <strong>Frozen Stops & Incremental Churn:</strong> When replanning in response to
                new events (e.g., road blockages, offline vehicles), previously committed stops are
                strictly frozen and cannot be moved. This guarantees crew predictability at the
                expense of global schedule optimality.
              </li>
            </ul>
          </div>
        </section>

        {/* SECTION F: Human-Supervised Operations */}
        <section
          id="human-supervision"
          aria-labelledby="human-supervision-heading"
          className="bg-white p-6 md:p-8 rounded-lg border border-slate-200 shadow-xs"
        >
          <div className="flex items-center gap-2 mb-3">
            <span
              className="material-symbols-outlined text-[#0066CC]"
              data-icon="supervisor_account"
            >
              supervisor_account
            </span>
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
              Section 6
            </span>
          </div>
          <h2
            id="human-supervision-heading"
            className="text-xl md:text-2xl font-bold text-[#0A2540] mb-4"
          >
            Human-Supervised Operations (No Autonomous Commitment)
          </h2>
          <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <p>
              FloodRelay adheres strictly to human-in-the-loop safety principles. The platform
              enforces the following non-negotiable operational invariants:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
              <li>
                <strong>No Autonomous Dispatch:</strong> The solver engine only produces{' '}
                <code>PROPOSED</code> assignments. It is technically barred from self-committing
                plans.
              </li>
              <li>
                <strong>Authoritative Operator Authorization:</strong> An assignment status advances
                to <code>COMMITTED</code> only when an authenticated operator explicitly submits an
                authorization action through the Command Center with server-enforced credentials.
              </li>
              <li>
                <strong>Commitment Semantics:</strong> Clicking &quot;Commit Assignment&quot;
                records an administrative planning decision in PostgreSQL and freezes the mission
                stops. It does <strong>not</strong> physically trigger vehicle ignition, vessel
                departure, or automated radio transmission.
              </li>
              <li>
                <strong>Immutable Audit Logging:</strong> Every state change, rejection, and
                operator attribution is permanently recorded in transactional audit logs to ensure
                accountability.
              </li>
            </ul>
          </div>
        </section>

        {/* SECTION G: Operational Availability & Technical Dependencies */}
        <section
          id="operational-availability"
          aria-labelledby="operational-availability-heading"
          className="bg-white p-6 md:p-8 rounded-lg border border-slate-200 shadow-xs"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#0066CC]" data-icon="cloud_off">
              cloud_off
            </span>
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
              Section 7
            </span>
          </div>
          <h2
            id="operational-availability-heading"
            className="text-xl md:text-2xl font-bold text-[#0A2540] mb-4"
          >
            Operational Availability & Technical Dependencies
          </h2>
          <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
            <p>
              The platform depends on several software and network layers that are subject to
              degradation during severe meteorological events:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
              <li>
                <strong>Network Degradation:</strong> Emergency centers experiencing intermittent
                broadband will see live polling fallback to cached data. Stale dashboard indicators
                inform operators when telemetry was last refreshed.
              </li>
              <li>
                <strong>External API Dependencies:</strong> Third-party geocoding and map tile
                providers may experience latency spikes or rate-limiting during surge events.
              </li>
              <li>
                <strong>Database ACID Guarantees:</strong> Core state transitions rely on
                single-database PostGIS transactions with row-level locking. High-concurrency
                operations will queue safely rather than corrupt state, but may experience transient
                latency.
              </li>
              <li>
                <strong>No Unconditional Uptime Warranty:</strong> FloodRelay is provided as open
                decision-support software. No guarantee of uninterrupted service, infinite
                throughput, or instantaneous rescue dispatch is expressed or implied.
              </li>
            </ul>
          </div>
        </section>

        {/* SECTION H: Summary Invariant Table */}
        <section
          aria-labelledby="summary-table-heading"
          className="bg-white p-6 md:p-8 rounded-lg border border-slate-200 shadow-xs"
        >
          <h2 id="summary-table-heading" className="text-lg font-bold text-[#0A2540] mb-4">
            System Invariant Summary
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-900 font-semibold">
                  <th className="py-2.5 px-3">System Domain</th>
                  <th className="py-2.5 px-3">Enforced Invariant</th>
                  <th className="py-2.5 px-3">Operational Boundary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2 px-3 font-semibold text-slate-900">Dispatch Authority</td>
                  <td className="py-2 px-3">Decision support only; never auto-committed</td>
                  <td className="py-2 px-3">Requires authenticated human review</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-semibold text-slate-900">Committed Stops</td>
                  <td className="py-2 px-3">Strictly frozen across subsequent replans</td>
                  <td className="py-2 px-3">Guarantees field crew mission continuity</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-semibold text-slate-900">Citizen Intake</td>
                  <td className="py-2 px-3">Zero login barrier for distress reports</td>
                  <td className="py-2 px-3">Intake rate-limiting & duplicate flagging</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-semibold text-slate-900">Duplicate Reports</td>
                  <td className="py-2 px-3">Flagged for review, never silently deleted</td>
                  <td className="py-2 px-3">Preserves all potential human distress calls</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-semibold text-slate-900">Vehicle Shifts</td>
                  <td className="py-2 px-3">Total route & return within maxShiftMinutes</td>
                  <td className="py-2 px-3">Prevents stranding crews in flood zones</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto bg-slate-100 border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© 2026 FloodRelay Project. Human-Supervised Emergency Decision Support.</p>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <Link href="/citizen" className="hover:text-slate-800 transition-colors">
              Citizen Portal
            </Link>
            <Link href="/operator/login" className="hover:text-slate-800 transition-colors">
              Operator Command
            </Link>
            <a
              href="#emergency-safety"
              className="text-amber-700 hover:text-amber-900 transition-colors"
            >
              Emergency Guidance
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
