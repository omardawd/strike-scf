// The scripted timeline for the demo@demo.com cinematic tour. Every
// `navSteps` target and every `target` is a `data-demo-target` attribute on a
// real, live component — there is no cloned or mocked version of the
// platform anywhere in this feature, with one deliberate, clearly-labeled
// exception (the Scene 8 Slack "Coming soon" mockup — see SlackMockup.tsx).
// IDs below come from supabase/seed-demo.sql (the isolated demo tenant) —
// see lib/demo-entities.ts for the full seeded entity list.
//
// Scenes are either full-screen narrated text (`kind: 'text'`), a spotlight
// highlight on a real live UI element (`kind: 'spotlight'`), or the one
// static concept mockup (`kind: 'mockup'`). Getting from one real page to the
// next is never a direct route jump — DemoConductor drives a visible cursor
// through the SAME clicks a real user would make (`navSteps`), e.g. sidebar
// link -> list item -> detail page, exactly like clicking through the app.

import {
  DEMO_IRONBRIDGE_COILS_LISTING_ID,
  DEMO_IRONBRIDGE_DEAL_ID,
  DEMO_CEDARLINE_DEAL_ID,
  DEMO_ROOM_ID,
} from '@/lib/demo-entities'

export type SceneKind = 'text' | 'spotlight' | 'mockup' | 'agent-demo'

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
   *  image — only meaningful on the 'welcome' beat. */
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
  /** Dark, high-contrast variant of `kind: 'text'` — the one deliberate Scene 5 beat. */
  dark?: boolean
  /** Ambient AI-gradient background for `kind: 'text'` (Scene 6). */
  aiGradient?: boolean
  iconSet?: 'audio'
  /** Text scenes only — don't auto-advance; wait for a click (arms audio playback), then hold `holdMs`. */
  requireClick?: boolean
  /** Which static mockup to render for `kind: 'mockup'`. */
  mockupId?: 'slack'
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

  // ── Scene 2 — Strike Passport (real click path: sidebar -> Strike Passport) ──
  // Lands on Home first (see DemoConductor's start()) — this is the beat that
  // actually clicks away from it, so the tour visibly begins from the same
  // page a real login would.
  scene({
    id: 'passport-score',
    kind: 'spotlight',
    narration: 'Every business on Strike carries a PassportScore — a real-time trust score built from real trade activity, scored the same way our own analysts would.',
    navSteps: [{ target: 'nav-passport' }],
    target: 'passport-score-summary',
  }),
  scene({
    id: 'passport-breakdown',
    kind: 'spotlight',
    narration: 'KYB compliance, financial health, trade reliability, network reputation — scored, explained, and always current.',
    target: 'passport-dimensions',
  }),

  // ── Scene 3 — Strike Place + Strike Rooms ───────────────────────────────
  scene({
    id: 'strike-place-intro',
    kind: 'spotlight',
    narration: 'Strike Place is where businesses list and discover real trade opportunities on the network.',
    navSteps: [{ target: 'nav-marketplace' }],
    target: 'marketplace-grid',
  }),
  scene({
    id: 'strike-place-listing',
    kind: 'spotlight',
    narration: 'Real inventory, from a real, verified counterparty.',
    target: `listing-card-${DEMO_IRONBRIDGE_COILS_LISTING_ID}`,
  }),
  scene({
    id: 'strike-rooms',
    kind: 'spotlight',
    narration: 'Every negotiation happens in the open, in Strike Rooms — real terms, real reasoning, never hidden in a log somewhere.',
    navSteps: [{ target: 'nav-rooms' }, { target: `room-item-${DEMO_ROOM_ID}` }],
    target: 'room-thread',
    extraMs: 800,
  }),

  // ── Scene 4 — deal flow + financing request ─────────────────────────────
  scene({
    id: 'deal-flow',
    kind: 'spotlight',
    narration: 'Once terms are agreed, the deal moves through one clear lifecycle — from contract to shipment to payment.',
    navSteps: [{ target: 'nav-deals' }, { target: `deal-row-${DEMO_IRONBRIDGE_DEAL_ID}` }],
    target: 'deal-negotiation',
  }),
  scene({
    id: 'financing-1',
    kind: 'spotlight',
    narration: 'And at any point, you can request financing against a receivable directly from the deal.',
    navSteps: [{ target: 'nav-deals' }, { target: `deal-row-${DEMO_CEDARLINE_DEAL_ID}` }],
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
    title: "But none of this is built for you.",
    subtitle: 'Everything you just saw — the sourcing, the vetting, the back-and-forth, the paperwork — is work nobody should have to do by hand.',
    narration: "But none of this is built for you. Everything you just saw is work nobody should have to do by hand.",
    extraMs: 600,
  }),
  scene({
    id: 'twist-2',
    kind: 'text',
    dark: true,
    title: 'It’s built for Strike AI.',
    subtitle: 'Your business agent. It works the platform on your behalf — and only ever stops to ask when something is about to become a real commitment.',
    narration: "It's built for Strike AI — your business agent. It works the platform on your behalf, and only stops to ask when something becomes a real commitment.",
    extraMs: 800,
  }),

  // ── Scene 6 — what Strike AI does ───────────────────────────────────────
  scene({
    id: 'capabilities-1',
    kind: 'text',
    aiGradient: true,
    title: 'It sources. It vets. It negotiates. It closes. It finances.',
    subtitle: 'Not suggestions or drafts — real offers, real counter-offers, real deals, against real counterparties on the live network.',
    narration: 'It sources, vets, negotiates, closes, and finances — real offers against real counterparties, not drafts.',
  }),
  scene({
    id: 'capabilities-2',
    kind: 'text',
    aiGradient: true,
    title: 'The entire trade lifecycle — end to end.',
    subtitle: 'You stay in control of every commitment. Nothing becomes binding without you. Watch it work, live, right now.',
    narration: 'The entire trade lifecycle, end to end — with you in control of every commitment. Watch it work, live.',
    extraMs: 600,
  }),

  // ── Scene 7 — live agent demo (DemoAgentActivityFeed) ───────────────────
  // No `holdMs`/reading-time pacing here — the component drives its own
  // advance once the real propose → revise → GATE 1 → negotiate → GATE 2 →
  // finance sequence actually completes (see DemoConductor's `agent-demo`
  // special-case). `narration` is unused for pacing; the panel writes its
  // own live captions as the sequence progresses. The real underlying page
  // never left the Cedarline deal (financing-3) while the last two text
  // scenes covered it — this is the click back to Home.
  {
    id: 'live-agent-demo',
    kind: 'agent-demo',
    narration: 'Watch Strike AI work.',
    navSteps: [{ target: 'nav-home' }],
    target: 'home-chat-input',
    holdMs: 0,
  },

  // ── Scene 8 — integrations ──────────────────────────────────────────────
  // Settings has no sidebar link — a real user reaches it through the
  // account menu, so that's the click path here too.
  scene({
    id: 'erp-integration',
    kind: 'spotlight',
    narration: 'Strike connects directly to your ERP — real inventory, cash, and receivables, synced automatically.',
    navSteps: [{ target: 'user-menu-button' }, { target: 'user-menu-settings' }, { target: 'settings-tab-erp' }],
    target: 'erp-connection-card',
  }),
  scene({
    id: 'slack-mockup',
    kind: 'mockup',
    mockupId: 'slack',
    narration: 'And soon, right inside Slack.',
  }),

  // ── Scene 9 — closing ────────────────────────────────────────────────────
  scene({
    id: 'closing',
    kind: 'text',
    title: 'This is Strike.',
    subtitle: 'Sourcing to financing, run by an agent that never sleeps — and never commits you to anything you haven’t seen. The platform is yours now; go try it.',
    narration: 'This is Strike. Sourcing to financing, run by an agent that never commits you to anything you haven’t seen.',
    extraMs: 900,
  }),

  // Scene 10 (handoff) has no beat of its own — the overlay simply ends here
  // and the user free-drives the real platform themselves.
]
