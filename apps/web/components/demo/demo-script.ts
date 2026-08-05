// The scripted timeline for the demo@demo.com cinematic tour. Every
// `navSteps` target and every `target` is a `data-demo-target` attribute on a
// real, live component — there is no cloned or mocked version of the
// platform anywhere in this feature. IDs below come from
// supabase/seed-demo.sql (the isolated demo tenant) — see lib/demo-entities.ts
// for the full seeded entity list.
//
// Scenes are either full-screen narrated text (`kind: 'text'`), a spotlight
// highlight on a real live UI element (`kind: 'spotlight'`), or the one
// live agent-demo scene. Getting from one real page to the next is never a
// direct route jump — DemoConductor drives a visible cursor through the SAME
// clicks a real user would make (`navSteps`), e.g. sidebar link -> list item
// -> detail page, exactly like clicking through the app. The one deliberate
// exception is the very first reveal (`fadeReveal`, see 'passport-score'
// below) — that's the moment the app itself "loads you in" after the welcome
// title, not a navigation a user performs, so it fades rather than clicks.

import {
  DEMO_IRONBRIDGE_COILS_LISTING_ID,
  DEMO_CEDARLINE_DEAL_ID,
  DEMO_ROOM_ID,
  DEMO_PLAN_TASK_ID,
} from '@/lib/demo-entities'

export type SceneKind = 'text' | 'spotlight' | 'agent-demo'

export interface DemoFormFill {
  type: string
  amount: string
  rateMax: string
}

export interface NavStep {
  /** `data-demo-target` of the real, clickable element for this step. */
  target: string
}

export interface DemoBeat {
  id: string
  kind: SceneKind
  /** Caption (spotlight scenes) or body copy (text scenes). Also drives reading-time pacing. */
  narration: string
  holdMs: number
  /** Large heading for `kind: 'text'` scenes. */
  title?: string
  /** Supporting spoken line rendered under the heading on `kind: 'text'` scenes.
   *  Without this a title-only beat shows a headline and nothing else, which is
   *  why the tour used to go visually silent from the Scene 5 twist onward. */
  subtitle?: string
  /** Replaces the "Strike SCF" wordmark text in the title with the real logo
   *  image — used on the 'welcome' and 'closing' beats. */
  logoInTitle?: boolean
  /** Ordered real clicks (sidebar link, list item, tab button...) the cursor
   *  performs to get from wherever the previous beat left off to this beat's
   *  page/state — the same path a user would take, never a route jump. Empty
   *  or omitted means this beat is on the same page as the previous one. */
  navSteps?: NavStep[]
  /** `data-demo-target` value — required for `kind: 'spotlight'`/`'agent-demo'`.
   *  DemoConductor waits for this element to actually mount before starting
   *  the hold countdown, so a slow page/navigation never gets cut off mid-load. */
  target?: string
  /** Skip the dimming/highlight box around `target` — the element is still
   *  used to gate readiness, but nothing is drawn around it. Used for a beat
   *  that wants the viewer to take in a whole page rather than have one
   *  region called out (e.g. the Strike Place grid on first arrival). */
  noHighlight?: boolean
  /** Delays mounting the dimming/highlight box by this many ms after the
   *  target is otherwise ready — the plain page gets a moment to just be
   *  seen before the tour starts pointing at anything on it. */
  spotlightDelayMs?: number
  /** The one beat that "loads in" rather than being clicked to — pushes
   *  `directRoute` itself (timed so the destination page's own mount +
   *  entrance animation is still visible), then a brief white veil fades out
   *  over the freshly-rendered page/spotlight instead of a cursor click
   *  driving a navSteps sequence. See the module doc comment. */
  fadeReveal?: boolean
  /** Real route this beat navigates to on its own — only meaningful paired
   *  with `fadeReveal` (every other beat gets there via `navSteps` instead). */
  directRoute?: string
  /** Dark, high-contrast variant of `kind: 'text'` — the one deliberate Scene 5 beat. */
  dark?: boolean
  /** Ambient AI-gradient background for `kind: 'text'`. */
  aiGradient?: boolean
  iconSet?: 'audio'
  /** Text scenes only — don't auto-advance; wait for a click (arms audio playback), then hold `holdMs`. */
  requireClick?: boolean
  /** Fill the deal page's financing-request form via DemoFormBridge. */
  formFill?: DemoFormFill
  /** Submit the financing-request form via DemoFormBridge (creates a real row). */
  submitForm?: boolean
}

// How long a beat's content stays on screen once it's actually ready to show
// (i.e. after navigation + target are confirmed present for spotlight beats).
// Scales with how much there is to read — ~2.5 words/sec (a natural spoken
// pace, not a slow one) plus a smaller fixed buffer for the beat to register
// before the caption starts counting down. The old 2 words/sec + 2600ms combo
// made anything past a one-line caption feel like a stall, especially beats
// with no motion of their own to watch while reading.
function readingHoldMs(narration: string, extraMs = 0): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length
  const readMs = (words / 2.5) * 1000
  return Math.round(Math.max(3200, readMs + 1800)) + extraMs
}

function scene(input: Omit<DemoBeat, 'holdMs'> & { extraMs?: number }): DemoBeat {
  const { extraMs, ...rest } = input
  return { ...rest, holdMs: readingHoldMs(rest.narration, extraMs) }
}

export const DEMO_SCENES: DemoBeat[] = [
  // ── Scene 0 — audio gate ────────────────────────────────────────────────
  {
    id: 'audio-gate',
    kind: 'text',
    narration: 'This is a hands-free experience — turn your sound on to hear your narrator.',
    iconSet: 'audio',
    requireClick: true,
    holdMs: 10000, // explicit ~10s hold after the click, not reading-time-derived
  },

  // ── Scene 1 — welcome ───────────────────────────────────────────────────
  scene({
    id: 'welcome',
    kind: 'text',
    title: 'Welcome to',
    logoInTitle: true,
    narration: 'Welcome to Strike SCF.',
  }),

  // ── Scene 2 — Strike Passport ────────────────────────────────────────────
  // Lands on the Passport page by navigating itself (directRoute), not a
  // click a user performs — the app "loading you in" right after the title.
  // The plain page shows first (spotlightDelayMs) so the viewer actually
  // sees it arrive before anything gets highlighted on it.
  scene({
    id: 'passport-score',
    kind: 'spotlight',
    narration: 'Every business on Strike carries a Passport, a real-time trust score built from real trade activity, documentation, financial health, and market credibility.',
    fadeReveal: true,
    directRoute: '/passport',
    spotlightDelayMs: 1100,
    target: 'passport-score-summary',
    extraMs: 1100,
  }),
  scene({
    id: 'passport-breakdown',
    kind: 'spotlight',
    narration: 'The four main metrics that generate a PassportScore are onboarding KYB to verify who they are, financial health from the balance sheet, trade reliability by tracking delivery and payment history, and network reputation.',
    target: 'passport-dimensions',
  }),
  scene({
    id: 'passport-documents',
    kind: 'spotlight',
    narration: 'The Passport also houses an organization’s ISO certificates, incorporation records, compliance documents, and other relevant documents for their trade profile.',
    target: 'passport-documents',
  }),

  // ── Scene 3 — Strike Place + Strike Rooms ───────────────────────────────
  scene({
    id: 'strike-place-intro',
    kind: 'spotlight',
    narration: 'Strike Place is where businesses list their services or needs and discover real trade opportunities on the network.',
    navSteps: [{ target: 'nav-marketplace' }],
    target: 'marketplace-grid',
    noHighlight: true,
  }),
  scene({
    id: 'strike-place-listing-intro',
    kind: 'spotlight',
    narration: 'Every listing carries the full trade terms — quantity, incoterms, price, and counterparty’s Passport.',
    navSteps: [{ target: `listing-card-${DEMO_IRONBRIDGE_COILS_LISTING_ID}` }],
    target: 'listing-detail-poster',
    noHighlight: true,
  }),
  scene({
    id: 'strike-place-listing-passport',
    kind: 'spotlight',
    narration: 'And right there is the counterparty’s own PassportScore, where you can initially vet the counterparty before submitting an offer.',
    target: 'listing-detail-poster',
  }),
  scene({
    id: 'strike-place-listing-offer',
    kind: 'spotlight',
    narration: 'Scroll down and you’ll find the offer submission window, where you can send your first offer or your counter-offer.',
    target: 'listing-detail-offer',
    extraMs: 400,
  }),
  scene({
    id: 'strike-rooms',
    kind: 'spotlight',
    narration: 'Every negotiation occurs in the listing’s respective Strike Room, where representatives or agents can easily communicate.',
    navSteps: [{ target: 'nav-rooms' }, { target: `room-item-${DEMO_ROOM_ID}` }],
    target: 'room-thread',
    extraMs: 300,
  }),

  // ── Scene 4 — deal lifecycle + financing request ────────────────────────
  // One deal carries both beats — the same page shows the full agreed-to-
  // completed roadmap AND the financing action, so there's no confusing
  // "back to the list, into a different deal" hop between them.
  scene({
    id: 'deal-flow',
    kind: 'spotlight',
    narration: 'An active deal moves through one clear lifecycle with eight tracked stages, from agreeing on pricing to completing the transaction.',
    navSteps: [{ target: 'nav-deals' }, { target: `deal-row-${DEMO_CEDARLINE_DEAL_ID}` }],
    target: 'deal-negotiation',
    extraMs: 300,
  }),
  scene({
    id: 'deal-contract',
    kind: 'spotlight',
    narration: 'This deal is well past that first handshake, where a trade contract was signed weeks ago, so this is already finalized.',
    target: 'deal-contract',
    extraMs: 400,
  }),
  scene({
    id: 'financing-1',
    kind: 'spotlight',
    narration: 'At any point, you can request financing against a receivable directly from the same deal.',
    target: 'financing-toggle',
  }),
  scene({
    id: 'financing-2',
    kind: 'spotlight',
    narration: 'Let’s submit a financing request. We can try requesting a reverse factoring program on this receivable, capped at a 6.5% maximum APR.',
    target: 'financing-form',
    formFill: { type: 'reverse_factoring', amount: '130000', rateMax: '6.5' },
    extraMs: 800,
  }),
  scene({
    id: 'financing-3',
    kind: 'spotlight',
    narration: 'Submitted! This request is now viewable by financial providers, and you’ll receive offers as they come in.',
    target: 'financing-submit',
    submitForm: true,
    extraMs: 800,
  }),

  // ── Scene 5 — the twist (the one dark beat) ─────────────────────────────
  scene({
    id: 'twist-1',
    kind: 'text',
    dark: true,
    title: 'But none of this is built for you.',
    narration: 'But none of this is built for you.',
    extraMs: 600,
  }),
  scene({
    id: 'twist-2',
    kind: 'text',
    dark: true,
    title: 'It’s built for your agent, Strike AI.',
    narration: 'It’s built for your agent, Strike AI.',
    extraMs: 800,
  }),

  // ── Scene 6 — live agent demo (DemoAgentActivityFeed) ───────────────────
  // No `holdMs`/reading-time pacing here — the component drives its own
  // advance once the real propose -> revise -> execute -> negotiate ->
  // finalize -> finance sequence actually completes (see DemoConductor's
  // `agent-demo` special-case). `narration` is unused for pacing; the panel
  // writes its own live captions as the sequence progresses. This is the
  // click back to Home from wherever the last spotlight beat left off.
  {
    id: 'live-agent-demo',
    kind: 'agent-demo',
    narration: 'Watch Strike AI work.',
    navSteps: [{ target: 'nav-home' }],
    target: 'home-chat-input',
    holdMs: 0,
  },

  // ── Scene 7 — integrations ───────────────────────────────────────────────
  // Settings has no sidebar link — a real user reaches it through the
  // account menu, so that's the click path here too.
  scene({
    id: 'erp-integration',
    kind: 'spotlight',
    narration: 'Strike AI can connect directly to your ERP with read-only permissions to keep your data safe.',
    navSteps: [{ target: 'user-menu-button' }, { target: 'user-menu-settings' }, { target: 'settings-tab-erp' }],
    target: 'erp-connection-card',
  }),
  // What the sync actually produces: a real, standing proposal Strike AI
  // already wrote from the synced ERP data (the seeded 'de900000-...-001'
  // scan_advisory task — flags a steel racking shortfall and recommends a
  // follow-on offer) — not just a "data connected" checkmark with nothing
  // to show for it.
  scene({
    id: 'erp-ai-proposal',
    kind: 'spotlight',
    narration: 'Reasoning from that resource is extremely powerful. Strike can generate proposals that came from your own ERP. You can revise its plan and then execute, like how we did before.',
    navSteps: [{ target: 'nav-ai' }, { target: 'ai-tab-agent' }],
    target: `agent-task-${DEMO_PLAN_TASK_ID}`,
    extraMs: 400,
  }),
  // The other side of the same ERP connection: existing receivables it
  // already found, ready to become a deal (and a financing request) in one
  // click, no manual data entry.
  scene({
    id: 'deals-erp-import',
    kind: 'spotlight',
    narration: 'Strike also can import your existing trade deals to submit financing requests easily.',
    navSteps: [{ target: 'nav-deals' }],
    target: 'deals-erp-import',
    extraMs: 300,
  }),

  // ── Scene 8 — closing ────────────────────────────────────────────────────
  // Logo only — no headline text, no spoken line, no audio at all. An empty
  // `narration` here means DemoConductor's hold timer runs silently (see its
  // own `else` branch) instead of calling narrate(); `readingHoldMs('')`
  // still floors at a sensible minimum so the beat holds for a beat, not
  // zero seconds. DemoConductor redirects to /home once this beat's hold
  // ends (see `finish()`), so the tour hands the viewer back to the real,
  // live app rather than stranding them here.
  scene({
    id: 'closing',
    kind: 'text',
    logoInTitle: true,
    subtitle: '',
    narration: '',
    extraMs: 1400,
  }),

  // Scene 9 (handoff) has no beat of its own — the overlay simply ends here
  // and the user free-drives the real platform themselves.
]
