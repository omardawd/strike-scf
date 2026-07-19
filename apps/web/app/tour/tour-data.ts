// Scripted content for the /tour walkthrough. Everything here is static —
// no API calls, no auth, no live data. Round/reasoning text in the
// "negotiation" and "room" scenes is drawn verbatim from a real autonomous
// negotiation run live during development (5 rounds, $495,000 -> $422,000),
// not invented dialogue — it's what Strike AI actually said.

export type TourTone = 'default' | 'good' | 'warn' | 'bad'

export interface NegotiationRound {
  round: number
  byOrgName: string
  isYou: boolean
  price: number
  incoterms: string
  paymentTerms: string
  shippingCost?: number
  reasoning: string
}

export type TourScene =
  | {
      kind: 'title'
      id: string
      eyebrow: string
      title: string
      subtitle: string
      cta: string
    }
  | {
      kind: 'dashboard'
      id: string
      sceneLabel: string
      heading: string
      subheading: string
      insight: { tone: TourTone; title: string; body: string }
      kpis: { label: string; value: string }[]
    }
  | {
      kind: 'gate'
      id: string
      sceneLabel: string
      badge: string
      title: string
      body: string
      toolName: string
      summaryLine: string
      guardrailLine?: string
      approveLabel: string
      footer: string
    }
  | {
      kind: 'negotiation'
      id: string
      sceneLabel: string
      listingTitle: string
      buyerName: string
      supplierName: string
      youAre: 'buyer' | 'supplier'
      currency: string
      rounds: NegotiationRound[]
    }
  | {
      kind: 'room'
      id: string
      sceneLabel: string
      roomTitle: string
      messages: {
        author: string
        isAI: boolean
        content: string
        block?: Record<string, unknown>
      }[]
    }
  | {
      kind: 'financing'
      id: string
      sceneLabel: string
      heading: string
      body: string
      offers: {
        bankName: string
        rate: string
        tenor: string
        recommended?: boolean
      }[]
    }
  | {
      kind: 'chat'
      id: string
      sceneLabel: string
      messages: {
        role: 'user' | 'assistant'
        content: string
        block?: Record<string, unknown>
      }[]
    }
  | {
      kind: 'capstone'
      id: string
      heading: string
      body: string
      ctaLabel: string
      ctaHref: string
    }

export const TOUR_SCENES: TourScene[] = [
  {
    kind: 'title',
    id: 'title',
    eyebrow: 'STRIKE SCF — PRODUCT TOUR',
    title: 'Watch Strike AI run a trade — start to finish.',
    subtitle:
      'A guided walkthrough of sourcing, autonomous negotiation, financing, and capital reasoning — on real product screens. No login, no scheduled call.',
    cta: 'Begin the tour',
  },
  {
    kind: 'dashboard',
    id: 'dashboard',
    sceneLabel: 'Dashboard',
    heading: 'Good morning, Walmart',
    subheading: 'Strike AI already found something worth your attention.',
    insight: {
      tone: 'warn',
      title: 'Steel inventory is running critically low',
      body: 'STEEL-HRC-500 shows 12 units on hand against 45 units reserved across open orders. At current burn, the Bentonville distribution center runs out in 6 days. Strike AI has identified a matching supplier on Strike Place.',
    },
    kpis: [
      { label: 'Active Deals', value: '14' },
      { label: 'Trade Volume (90d)', value: '$4.2M' },
      { label: 'Avg PassportScore', value: '75' },
      { label: 'Open Financing', value: '$680K' },
    ],
  },
  {
    kind: 'gate',
    id: 'gate1',
    sceneLabel: 'Strike AI — Agent',
    badge: 'Needs Approval',
    title: 'Submit an offer on "505 MT Steel Products — July 2026 Delivery"',
    body: "Rocket Corp is offering steel that matches Walmart's shortage exactly — 505 MT, deliverable in time for the Bentonville replenishment window. Strike AI recommends opening at $475,000, based on current HRC benchmarks and Rocket Corp's PassportScore of 69.",
    toolName: 'submit_marketplace_offer',
    summaryLine: 'Offer: $475,000 · CFR · Net 30 · Delivery Jul 31, 2026',
    guardrailLine: 'Guardrails: price ceiling $520,000 · max 10 rounds',
    approveLabel: 'Approve & Submit',
    footer:
      "Once approved, Strike AI negotiates the rest on its own — you'll only be asked again before anything is finalized.",
  },
  {
    kind: 'negotiation',
    id: 'negotiation',
    sceneLabel: 'Strike Place — Live Negotiation',
    listingTitle: '505 MT Steel Products — July 2026 Delivery',
    buyerName: 'Walmart',
    supplierName: 'Rocket Corp',
    youAre: 'buyer',
    currency: 'USD',
    rounds: [
      {
        round: 1,
        byOrgName: 'Rocket Corp',
        isYou: false,
        price: 495000,
        incoterms: 'CFR',
        paymentTerms: 'Net 30',
        reasoning:
          'Offer submitted at $980/MT for 505MT steel, CFR Bentonville. Price reflects current HRC benchmarks and freight.',
      },
      {
        round: 2,
        byOrgName: 'Walmart',
        isYou: true,
        price: 388700,
        incoterms: 'CFR',
        paymentTerms: 'Net 30',
        reasoning:
          'Your offer of $495,000 is significantly above our target budget of $388,700 for 505 MT. Market data shows global steel prices are softening due to structural overcapacity and weak demand, with HRC trending down — giving buyers meaningful leverage. Countering at target price of $388,700 (≈$769/MT all-in CFR).',
      },
      {
        round: 3,
        byOrgName: 'Rocket Corp',
        isYou: false,
        price: 440000,
        incoterms: 'CFR',
        paymentTerms: 'Net 30',
        shippingCost: 22000,
        reasoning:
          'Market data as of July 2026 shows HRC prices at their highest since May 2023, supported by Section 232 tariffs and constrained spot supply. Moving substantially from $495,000 to $440,000 (~$871/MT all-in CFR) — a meaningful concession that still reflects real cost of goods and freight.',
      },
      {
        round: 4,
        byOrgName: 'Walmart',
        isYou: true,
        price: 410000,
        incoterms: 'CFR',
        paymentTerms: 'Net 30',
        shippingCost: 22000,
        reasoning:
          'HRC spot prices have actually dipped ~0.42% over the past month and the trend remains softening — $440,000 still exceeds a fair range given current market momentum. Moving meaningfully to $410,000 (~$812/MT CFR), keeping all other terms unchanged.',
      },
      {
        round: 5,
        byOrgName: 'Rocket Corp',
        isYou: false,
        price: 422000,
        incoterms: 'CFR',
        paymentTerms: 'Net 30',
        shippingCost: 18500,
        reasoning:
          'Market data confirms US Midwest HRC is trading at $1,193/MT as of mid-July — still 36% above year-ago levels — with constrained mill spot availability. At $422,000 (~$836/MT all-in), bridging meaningfully toward your position while staying grounded in real cost-of-goods and freight.',
      },
    ],
  },
  {
    kind: 'gate',
    id: 'gate2',
    sceneLabel: 'Strike AI — Agent',
    badge: 'Needs Approval — Finalize',
    title: 'Finalize negotiation on "505 MT Steel Products"',
    body: 'Round 5 settled at $422,000 (~$836/MT CFR) — within guardrails and a reasonable outcome relative to current market pricing. Strike AI recommends accepting, but will not do so without your review.',
    toolName: 'accept_marketplace_offer',
    summaryLine: 'Final terms: $422,000 · CFR · Net 30 · Shipping $18,500 · Delivery Jul 31, 2026',
    approveLabel: 'Approve & Finalize',
    footer: 'This is the only moment Strike AI ever creates a binding deal — and it always waits for you.',
  },
  {
    kind: 'room',
    id: 'room',
    sceneLabel: 'Strike Rooms',
    roomTitle: '505 MT Steel Products — Deal Room',
    messages: [
      {
        author: 'Rocket Corp',
        isAI: true,
        content:
          'Round 3 — countered at $440,000. Market data as of July 2026 shows HRC prices at their highest since May 2023, supported by Section 232 tariffs and constrained spot supply.',
      },
      {
        author: 'Walmart',
        isAI: true,
        content:
          'Round 4 — countered at $410,000. HRC spot prices have dipped ~0.42% over the past month; the trend remains softening.',
      },
      {
        author: 'Rocket Corp',
        isAI: true,
        content: 'Round 5 — countered at $422,000, bridging meaningfully toward your position.',
        block: {
          type: 'comparison',
          title: 'Round 5',
          left: {
            label: 'Previous (Round 4)',
            items: [
              { label: 'Price', value: '410,000 USD' },
              { label: 'Incoterms', value: 'CFR' },
              { label: 'Payment Terms', value: 'Net 30' },
            ],
          },
          right: {
            label: "Rocket Corp's counter",
            items: [
              { label: 'Price', value: '422,000 USD' },
              { label: 'Incoterms', value: 'CFR' },
              { label: 'Payment Terms', value: 'Net 30' },
            ],
          },
        },
      },
      {
        author: 'System',
        isAI: false,
        content: 'Deal agreed. Both parties have confirmed terms.',
      },
    ],
  },
  {
    kind: 'financing',
    id: 'financing',
    sceneLabel: 'Financing',
    heading: 'Financing, automatically',
    body: 'The moment the deal is agreed, Strike AI drafts a financing request against the $422,000 receivable and ranks incoming bank offers by rate, speed, and flexibility.',
    offers: [
      { bankName: 'Atlas Bank', rate: '5.8%', tenor: '60 days', recommended: true },
      { bankName: 'Second National', rate: '6.4%', tenor: '45 days' },
      { bankName: 'Meridian Capital', rate: '7.1%', tenor: '90 days' },
    ],
  },
  {
    kind: 'chat',
    id: 'chat',
    sceneLabel: 'Strike AI — Chat',
    messages: [
      {
        role: 'user',
        content: 'Should we take on more steel deals like this one this quarter?',
      },
      {
        role: 'assistant',
        content:
          "Adding this $422,000 deal brings Rocket Corp's share of your trade book to 65.7%, up from 53.9% today — worth watching, but not disqualifying given their 69 PassportScore and clean payment history. Cash position remains healthy. I'd greenlight this one, but recommend diversifying the next 1-2 sourcing decisions toward other suppliers to keep concentration risk in check.",
        block: {
          type: 'comparison',
          title: 'Concentration risk',
          left: { label: 'Current', items: [{ label: 'Rocket Corp share', value: '53.9%' }] },
          right: { label: 'If we take this deal', items: [{ label: 'Rocket Corp share', value: '65.7%' }] },
        },
      },
    ],
  },
  {
    kind: 'capstone',
    id: 'capstone',
    heading: 'This is Strike AI.',
    body: 'It sources. It negotiates — autonomously, round after round. It finances. It reasons about your balance sheet before you even ask. And it never commits you to anything without your say-so.',
    ctaLabel: 'Visit strikescf.com',
    ctaHref: 'https://strikescf.com',
  },
]
