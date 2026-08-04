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
  /** The one beat that "loads in" rather than being clicked to — a brief
   *  white veil fades out over the already-rendered page/spotlight instead of
   *  a cursor click driving a navSteps sequence. See the module doc comment. */
  fadeReveal?: boolean
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
// Scales with how much there is to read — ~2 words/sec, deliberately
// unhurried for a caption meant to be read *while* watching the scene.
function readingHoldMs(narration: string, extraMs = 0): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length
  const readMs = (words / 2) * 1000
  return Math.round(Math.max(3600, readMs + 2600)) + extraMs
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
  // Lands directly on the Passport page (see DemoConductor's start()) — the
  // app "loading you in" right after the title, not a click a user performs,
  // so this one beat fades in rather than driving the cursor to a sidebar link.
  scene({
    id: 'passport-score',
    kind: 'spotlight',
    narration: 'Every business on Strike carries a PassportScore — a real-time trust score built from real trade activity, scored the same way our own analysts would.',
    fadeReveal: true,
    target: 'passport-score-summary',
  }),
  scene({
    id: 'passport-breakdown',
    kind: 'spotlight',
    narration: 'KYB compliance verifies who they legally are. Financial health reads the balance sheet. Trade reliability tracks on-time delivery and payment history. Network reputation weighs real peer reviews — each worth up to 25 points, rolling up into one number a CFO can trust at a glance.',
    target: 'passport-dimensions',
    extraMs: 800,
  }),
  scene({
    id: 'passport-documents',
    kind: 'spotlight',
    narration: 'And the underwriting paper trail lives right here too — ISO certificates, incorporation records, compliance documents — not buried in an email thread.',
    target: 'passport-documents',
  }),

  // ── Scene 3 — Strike Place + Strike Rooms ───────────────────────────────
  scene({
    id: 'strike-place-intro',
    kind: 'spotlight',
    narration: 'Strike Place is where businesses list and discover real trade opportunities on the network.',
    navSteps: [{ target: 'nav-marketplace' }],
    target: 'marketplace-grid',
    noHighlight: true,
  }),
  scene({
    id: 'strike-place-listing',
    kind: 'spotlight',
    narration: 'Open a listing and this is how you’d submit an offer — or counter one already on the table.',
    navSteps: [{ target: `listing-card-${DEMO_IRONBRIDGE_COILS_LISTING_ID}` }],
    target: 'listing-detail-offer',
    extraMs: 400,
  }),
  scene({
    id: 'strike-rooms',
    kind: 'spotlight',
    narration: 'Every negotiation happens in the open, in Strike Rooms — real terms, real reasoning, never hidden in a log somewhere.',
    navSteps: [{ target: 'nav-rooms' }, { target: `room-item-${DEMO_ROOM_ID}` }],
    target: 'room-thread',
    extraMs: 800,
  }),

  // ── Scene 4 — deal lifecycle + financing request ────────────────────────
  // One deal carries both beats — the same page shows the full agreed-to-
  // completed roadmap AND the financing action, so there's no confusing
  // "back to the list, into a different deal" hop between them.
  scene({
    id: 'deal-flow',
    kind: 'spotlight',
    narration: 'Once terms are agreed, the deal moves through one clear lifecycle — agreed, contract, in business, shipped, received, accepted, payment, completed — eight stages from handshake to close.',
    navSteps: [{ target: 'nav-deals' }, { target: `deal-row-${DEMO_CEDARLINE_DEAL_ID}` }],
    target: 'deal-negotiation',
    extraMs: 600,
  }),
  scene({
    id: 'financing-1',
    kind: 'spotlight',
    narration: 'And at any point, you can request financing against a receivable directly from the same deal.',
    target: 'financing-toggle',
  }),
  scene({
    id: 'financing-2',
    kind: 'spotlight',
    narration: 'Reverse factoring on this receivable, up to a 6.5% rate ceiling.',
    target: 'financing-form',
    formFill: { type: 'reverse_factoring', amount: '130000', rateMax: '6.5' },
    extraMs: 1400,
  }),
  scene({
    id: 'financing-3',
    kind: 'spotlight',
    narration: 'Submitted — competing banks can now offer on it.',
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
    narration: 'Strike connects directly to your ERP — real inventory, cash, and receivables, synced automatically.',
    navSteps: [{ target: 'user-menu-button' }, { target: 'user-menu-settings' }, { target: 'settings-tab-erp' }],
    target: 'erp-connection-card',
  }),

  // ── Scene 8 — closing ────────────────────────────────────────────────────
  scene({
    id: 'closing',
    kind: 'text',
    title: 'This is',
    logoInTitle: true,
    narration: 'This is Strike. Sourcing to financing, run by an agent that never commits you to anything you haven’t seen.',
    extraMs: 900,
  }),

  // Scene 9 (handoff) has no beat of its own — the overlay simply ends here
  // and the user free-drives the real platform themselves.
]
