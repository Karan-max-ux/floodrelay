import { REGION_CONFIG } from '@/lib/region';
import React from 'react';
import Link from 'next/link';

export default function CitizenHomePage() {
  return (
    <main className="flex-1 pb-20 md:pb-12">
      {/* HERO SECTION */}
      <section className="relative bg-surface-container-lowest border-b border-outline-variant pt-8 pb-12 md:py-16 overflow-hidden">
        {/* Subtle decorative grid */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(#005c55 1px, transparent 1px), linear-gradient(90deg, #005c55 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="w-full max-w-7xl mx-auto px-4 md:px-8 relative z-10">
          <div className="max-w-3xl">
            {/* Status Pill */}
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-surface-container text-primary border border-outline-variant mb-4">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono">
                FloodRelay • Delhi Region
              </span>
            </div>

            {/* Headline */}
            <h1 className="font-manrope text-3xl md:text-5xl font-extrabold text-on-surface tracking-tight mb-4">
              Help Starts With Your Request
            </h1>

            {/* Reassuring Subhead */}
            <p className="text-base md:text-lg text-on-surface-variant mb-8 leading-relaxed max-w-2xl">
              Report your location and rescue needs to FloodRelay for operator review. This
              prototype does not directly dispatch emergency services.
            </p>

            {/* Primary & Secondary Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 mb-8">
              <Link
                className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 bg-primary-container text-on-primary text-base font-semibold rounded-lg shadow-sm hover:bg-primary transition-all duration-150 active:scale-[0.99] text-center"
                href="/citizen/request"
              >
                <span className="material-symbols-outlined text-[20px]" data-icon="emergency_home">
                  emergency_home
                </span>
                <span>Request Rescue Assistance</span>
                <span className="material-symbols-outlined text-[20px]" data-icon="arrow_forward">
                  arrow_forward
                </span>
              </Link>
              <a
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-surface-container-low text-on-surface border border-outline-variant text-base font-semibold rounded-lg hover:bg-surface-container transition-colors duration-150 text-center"
                href="#safety-guidance"
              >
                <span className="material-symbols-outlined text-[20px]" data-icon="menu_book">
                  menu_book
                </span>
                <span>View Safety Guidelines</span>
              </a>
            </div>

            {/* Reassurance Metadata Bar */}
            <div className="pt-4 border-t border-outline-variant/60 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs md:text-sm text-on-surface-variant">
              <div className="flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-primary text-[18px]"
                  data-icon="verified_user"
                >
                  verified_user
                </span>
                <span>Operator-assisted request review</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-primary text-[18px]"
                  data-icon="wifi_tethering"
                >
                  wifi_tethering
                </span>
                <span>Low-bandwidth optimized</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-primary text-[18px]"
                  data-icon="lock"
                >
                  lock
                </span>
                <span>Coordinates strictly private</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* REGIONAL STATUS TICKER */}
      <section className="bg-surface-container-low border-b border-outline-variant py-3 px-4 md:px-8">
        <div className="w-full max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs md:text-sm text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-container-highest font-mono text-xs uppercase font-bold text-on-surface">
              Region Status
            </span>
            <span className="font-semibold text-on-surface">Selected Region:</span>
            <span>{REGION_CONFIG.floodplain} • No live water-level feed</span>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium">
            <span className="flex items-center gap-1 text-primary">
              <span className="material-symbols-outlined text-[16px]" data-icon="check_circle">
                check_circle
              </span>
              Request form available
            </span>
            <span className="text-on-surface-variant">Check official flood advisories</span>
          </div>
        </div>
      </section>

      {/* THREE-STEP RESCUE WORKFLOW */}
      <section className="py-12 md:py-16 max-w-7xl mx-auto px-4 md:px-8">
        <div className="mb-10 text-left max-w-2xl">
          <div className="font-mono text-xs uppercase text-primary tracking-wider font-bold mb-2">
            How Request Review Operates
          </div>
          <h2 className="font-manrope text-2xl md:text-3xl text-on-surface font-bold tracking-tight">
            Three Steps from Request to Response Planning
          </h2>
          <p className="text-sm md:text-base text-on-surface-variant mt-2">
            Submitted requests may be reviewed by authorised operators when the FloodRelay backend
            is available.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Step 1 */}
          <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant flex flex-col justify-between group hover:border-primary transition-colors">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center font-manrope text-lg font-bold text-primary">
                  01
                </span>
                <span
                  className="material-symbols-outlined text-outline text-[24px]"
                  data-icon="edit_location"
                >
                  edit_location
                </span>
              </div>
              <h3 className="font-manrope text-lg text-on-surface font-bold mb-2">
                Submit Details
              </h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Provide your location, occupant head count, and flood level conditions. Flag
                mobility or medical needs to help operators evaluate response requirements.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-outline-variant/60 flex items-center text-xs text-primary font-semibold">
              <span>Takes under 90 seconds</span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant flex flex-col justify-between group hover:border-primary transition-colors">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center font-manrope text-lg font-bold text-primary">
                  02
                </span>
                <span
                  className="material-symbols-outlined text-outline text-[24px]"
                  data-icon="fact_check"
                >
                  fact_check
                </span>
              </div>
              <h3 className="font-manrope text-lg text-on-surface font-bold mb-2">
                Triage &amp; Review
              </h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Authorised operators review incident location and urgency priority. Incidents
                involving roof isolation and critical medical risks receive priority review.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-outline-variant/60 flex items-center text-xs text-primary font-semibold">
              <span>Operator review workflow</span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant flex flex-col justify-between group hover:border-primary transition-colors">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center font-manrope text-lg font-bold text-primary">
                  03
                </span>
                <span
                  className="material-symbols-outlined text-outline text-[24px]"
                  data-icon="directions_boat"
                >
                  directions_boat
                </span>
              </div>
              <h3 className="font-manrope text-lg text-on-surface font-bold mb-2">
                Response Planning
              </h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                If an authorised rescue team accepts the request, it may use the recorded location
                to plan a response. Submission does not guarantee deployment.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-outline-variant/60 flex items-center text-xs text-primary font-semibold">
              <span>Operator decision support</span>
            </div>
          </div>
        </div>
      </section>

      {/* CRITICAL SAFETY & FLOOD DIRECTIVES */}
      <section
        id="safety-guidance"
        className="py-12 bg-surface-container-low border-y border-outline-variant"
      >
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
            <div>
              <div className="font-mono text-xs uppercase text-tertiary-container font-bold tracking-wider mb-1">
                Public Safety Directives
              </div>
              <h2 className="font-manrope text-2xl md:text-3xl text-on-surface font-bold">
                Critical Flood Survival Guidance
              </h2>
            </div>
            <p className="text-xs md:text-sm text-on-surface-variant max-w-md">
              Follow instructions from official emergency services. Avoid flooded roads, drains and
              waterways.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Survival Protocols */}
            <div className="lg:col-span-7 bg-surface-container-lowest rounded-xl border border-outline-variant p-6 md:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-outline-variant">
                  <div className="w-8 h-8 rounded bg-error-container text-tertiary flex items-center justify-center">
                    <span
                      className="material-symbols-outlined text-[20px]"
                      data-icon="crisis_alert"
                    >
                      crisis_alert
                    </span>
                  </div>
                  <div>
                    <h3 className="font-manrope text-lg text-on-surface font-bold">
                      High Water Survival Protocols
                    </h3>
                    <p className="text-xs text-on-surface-variant">
                      Mandatory precautions in rising water areas
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-3.5 p-3 rounded bg-surface-container-low border-l-4 border-tertiary">
                    <span
                      className="material-symbols-outlined text-tertiary shrink-0 mt-0.5"
                      data-icon="waves"
                    >
                      waves
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-on-surface">
                        Avoid Moving Water Entirely
                      </h4>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Six inches of fast-moving flood water can knock an adult down. Twelve inches
                        can carry a passenger vehicle away. Never walk or drive through standing
                        depth.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5 p-3 rounded bg-surface-container-low border-l-4 border-tertiary">
                    <span
                      className="material-symbols-outlined text-tertiary shrink-0 mt-0.5"
                      data-icon="warning_amber"
                    >
                      warning_amber
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-on-surface">
                        Never Enter Flooded Basements
                      </h4>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Rapid water pressure can collapse foundation walls or cause electrical
                        live-wire hazards. Move to second stories or roof decks if staircases are
                        clear.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5 p-3 rounded bg-surface-container-low border-l-4 border-tertiary">
                    <span
                      className="material-symbols-outlined text-tertiary shrink-0 mt-0.5"
                      data-icon="power_settings_new"
                    >
                      power_settings_new
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-on-surface">
                        Turn Off Main Breaker If Safe
                      </h4>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Only turn off power if the breaker panel is in a completely dry area. Never
                        step into standing water to reach an electrical switch.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Preparation Checklist */}
            <div className="lg:col-span-5 bg-surface-container-lowest rounded-xl border border-outline-variant p-6 md:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-outline-variant">
                  <div className="w-8 h-8 rounded bg-surface-container text-primary flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]" data-icon="inventory_2">
                      inventory_2
                    </span>
                  </div>
                  <div>
                    <h3 className="font-manrope text-lg text-on-surface font-bold">
                      What to Prepare While Waiting
                    </h3>
                    <p className="text-xs text-on-surface-variant">
                      Checklist while awaiting assistance
                    </p>
                  </div>
                </div>

                <ul className="space-y-4 text-xs text-on-surface">
                  <li className="flex items-start gap-3 pb-3 border-b border-outline-variant/50">
                    <span
                      className="material-symbols-outlined text-primary text-[20px] shrink-0"
                      data-icon="flashlight_on"
                    >
                      flashlight_on
                    </span>
                    <div>
                      <span className="font-semibold block text-on-surface">
                        Signal Devices Ready
                      </span>
                      <span className="text-on-surface-variant">
                        Charge mobile devices on power-saving mode. Keep flashlights, whistles, or
                        bright towels visible for boat crews.
                      </span>
                    </div>
                  </li>
                  <li className="flex items-start gap-3 pb-3 border-b border-outline-variant/50">
                    <span
                      className="material-symbols-outlined text-primary text-[20px] shrink-0"
                      data-icon="dry_cleaning"
                    >
                      dry_cleaning
                    </span>
                    <div>
                      <span className="font-semibold block text-on-surface">
                        Dry Clothes &amp; Sturdy Shoes
                      </span>
                      <span className="text-on-surface-variant">
                        Seal dry clothing in plastic bags. Wear sturdy shoes to prevent puncture
                        injuries from submerged debris.
                      </span>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span
                      className="material-symbols-outlined text-primary text-[20px] shrink-0"
                      data-icon="medication"
                    >
                      medication
                    </span>
                    <div>
                      <span className="font-semibold block text-on-surface">
                        Vital Medications &amp; IDs
                      </span>
                      <span className="text-on-surface-variant">
                        Secure prescription medications, baby formula, government IDs, and emergency
                        phone numbers in a waterproof container.
                      </span>
                    </div>
                  </li>
                </ul>
              </div>

              <div className="mt-6 p-3 rounded bg-surface-container border border-outline-variant flex items-center gap-2.5">
                <span
                  className="material-symbols-outlined text-primary text-[20px]"
                  data-icon="info"
                >
                  info
                </span>
                <p className="text-xs text-on-surface-variant leading-tight">
                  Remain calm and conserve phone power. Authorised operators evaluate
                  life-threatening medical reports first.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* QUICK INQUIRY CALL BANNER */}
      <section className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-[28px]" data-icon="contact_support">
                contact_support
              </span>
            </div>
            <div>
              <h3 className="font-manrope text-lg font-bold text-on-surface">
                Need Emergency Assistance?
              </h3>
              <p className="text-sm text-on-surface-variant mt-1 max-w-xl">
                For immediate danger, call 112. FloodRelay does not verify live shelter availability
                or guarantee a physical rescue response.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <a
              className="px-5 py-2.5 rounded bg-surface-container text-on-surface font-semibold text-sm border border-outline-variant text-center hover:bg-surface-container-high transition-colors"
              href="tel:112"
            >
              Call 112 Emergency
            </a>
            <Link
              className="px-5 py-2.5 rounded bg-primary-container text-on-primary font-semibold text-sm text-center hover:bg-primary transition-colors"
              href="/citizen/request"
            >
              Start Request Form
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
