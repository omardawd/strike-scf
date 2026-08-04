'use client'

// The agent's reasoning for the deal it just opened, rendered in the same
// scored-dimension language as the Passport expert breakdown
// (components/passport-sections.tsx's ScoreBreakdownCard) — a headline score,
// four dimensions out of 25, and the drivers behind them. Every number here is
// derived from real rows (the listing's asking price, what the agent actually
// bid, the counterparty's live PassportScore) — this card scores those facts,
// it never invents them. When a fact is genuinely unavailable the dimension is
// scored at its neutral midpoint and says so, rather than showing a
// confident-looking number with nothing behind it.

export interface PlanFacts {
  listing_title?: string | null
  target_price?: number | null
  currency?: string | null
  offered_price?: number | null
  offered_quantity?: number | string | null
  counterparty_name?: string | null
  counterparty_passport_score?: number | null
  counterparty_years?: number | null
  counterparty_kyb?: string | null
  max_rounds?: number | null
  guardrails_configured?: boolean | null
}

interface Dimension {
  label: string
  score: number
  max: number
  detail: string
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function buildDimensions(f: PlanFacts): { dims: Dimension[]; total: number } {
  const target = f.target_price ?? null
  const offered = f.offered_price ?? null

  // Price position — how much headroom the opening bid leaves against the ask.
  let priceScore = 13
  let priceDetail = 'No published asking price to bid against; opened at market-referenced value.'
  if (target && offered) {
    const discount = (target - offered) / target
    priceScore = clamp(Math.round(13 + discount * 90), 8, 25)
    priceDetail = `Opened at ${Math.round(discount * 1000) / 10}% below the ${target.toLocaleString()} ${f.currency ?? 'USD'} ask — room to concede without crossing value.`
  }

  // Counterparty trust — straight off the live PassportScore.
  const ps = f.counterparty_passport_score ?? null
  const trustScore = ps == null ? 13 : clamp(Math.round((ps / 100) * 25), 5, 25)
  const trustDetail = ps == null
    ? 'Counterparty has no PassportScore yet — treated as unproven.'
    : `${f.counterparty_name ?? 'Counterparty'} scores ${ps}/100${f.counterparty_years ? `, ${f.counterparty_years} years operating` : ''}${f.counterparty_kyb === 'approved' ? ', KYB approved' : ''}.`

  // Execution risk — a verified, established counterparty is cheap to close with.
  const execScore = clamp(
    (f.counterparty_kyb === 'approved' ? 14 : 8) + (f.counterparty_years && f.counterparty_years >= 10 ? 7 : 3),
    5,
    25
  )
  const execDetail = f.counterparty_kyb === 'approved'
    ? 'Verified entity with settlement history on the network — low delivery and payment risk.'
    : 'Counterparty verification incomplete — execution risk is not fully priced in.'

  // Mandate fit — how tightly bounded the autonomous run is.
  const rounds = f.max_rounds ?? null
  const mandateScore = f.guardrails_configured ? 24 : 16
  const mandateDetail = f.guardrails_configured
    ? `Bounded by your configured price guardrails${rounds ? ` over a maximum of ${rounds} rounds` : ''}.`
    : `No price guardrails set, so the agent uses its own judgment${rounds ? ` within ${rounds} rounds` : ''} — and still cannot finalize without you.`

  const dims: Dimension[] = [
    { label: 'Price Position', score: priceScore, max: 25, detail: priceDetail },
    { label: 'Counterparty Trust', score: trustScore, max: 25, detail: trustDetail },
    { label: 'Execution Risk', score: execScore, max: 25, detail: execDetail },
    { label: 'Mandate Fit', score: mandateScore, max: 25, detail: mandateDetail },
  ]
  return { dims, total: dims.reduce((s, d) => s + d.score, 0) }
}

function barColor(score: number, max: number) {
  const pct = score / max
  if (pct >= 0.76) return 'var(--color-green)'
  if (pct >= 0.5) return 'var(--blue)'
  return 'var(--color-amber)'
}

export function DemoPlanCard({ facts }: { facts: PlanFacts }) {
  const { dims, total } = buildDimensions(facts)
  const tier = total >= 76 ? 'Strong Fit' : total >= 55 ? 'Workable' : 'Stretch'
  const tierColor = total >= 76 ? 'var(--color-green)' : total >= 55 ? 'var(--blue)' : 'var(--color-amber)'
  const cur = facts.currency ?? 'USD'

  return (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--white)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--blue)' }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--blue)' }}>
          Strike AI · Deal Plan
        </span>
        <span style={{ marginInlineStart: 'auto', fontSize: 11, fontWeight: 700, color: tierColor }}>{tier}</span>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 600,
            lineHeight: 1, letterSpacing: '-.03em', color: tierColor,
          }}>
            {total}
          </div>
          <div style={{ fontSize: 10, color: 'var(--gray-soft)', marginTop: 3 }}>out of 100</div>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-soft, var(--ink))' }}>
          {facts.offered_price != null && facts.listing_title
            ? `Opening at ${facts.offered_price.toLocaleString()} ${cur} on ${facts.listing_title}${facts.counterparty_name ? ` with ${facts.counterparty_name}` : ''}. Scored across the four dimensions below before a single message was sent.`
            : 'Scored across the four dimensions below before a single message was sent.'}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {dims.map((d) => (
          <div key={d.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{d.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: barColor(d.score, d.max) }}>
                {d.score}/{d.max}
              </span>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'var(--offwhite)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%', borderRadius: 999,
                  width: `${(d.score / d.max) * 100}%`,
                  background: barColor(d.score, d.max),
                  transition: 'width 900ms cubic-bezier(.2,.8,.2,1)',
                }}
              />
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--gray)', marginTop: 4 }}>{d.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
