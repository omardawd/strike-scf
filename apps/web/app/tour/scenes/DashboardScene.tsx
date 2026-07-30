import {
  Topbar, DashboardHeader, ActionQueueStrip, KpiStrip, PassportBanner, DealTable,
  type ActionCard, type KpiItem, type DealItem, type PassportData,
} from '@/components/dashboard/shared'
import type { TourScene } from '../tour-data'

const MOCK_PASSPORT: PassportData = {
  organization: {
    passport_score: 75,
    network_visible: true,
    passport_narrative: null,
    risk_tier: 'preferred',
    trade_count_total: 10,
    trade_volume_total: 1_608_700,
    avg_payment_days: 28,
  },
  avg_rating: 4.6,
  review_count: 8,
  org_view_count_30d: 42,
  bank_view_count_30d: 11,
}

const MOCK_ACTION_CARDS: ActionCard[] = [
  { color: 'var(--color-amber)', label: 'Listings with offers', href: '#', count: 2 },
  { color: 'var(--blue)', label: 'Financing offers received', href: '#', count: 1 },
]

const MOCK_DEALS: DealItem[] = [
  {
    id: 'mock-1',
    buyer_org_id: 'walmart',
    supplier_org_id: 'other-1',
    status: 'negotiating',
    goods_description: 'Lithium battery packs, 18650 cell, 10,000 units',
    total_value: 640000,
    agreed_price: null,
    counterparty: { id: 'other-1', legal_name: 'Volt Components Inc.', passport_score: 71 },
    user_role: 'buyer',
  },
  {
    id: 'mock-2',
    buyer_org_id: 'walmart',
    supplier_org_id: 'other-2',
    status: 'agreed',
    goods_description: 'Industrial aluminum sheets, 100 units',
    total_value: 212500,
    agreed_price: 212500,
    counterparty: { id: 'other-2', legal_name: 'Meridian Metals', passport_score: 82 },
    user_role: 'buyer',
  },
]

export default function DashboardScene({
  scene,
  onAdvance,
}: {
  scene: Extract<TourScene, { kind: 'dashboard' }>
  onAdvance: () => void
}) {
  // CountUp always needs a numeric `value` to animate — feed it 1 with a
  // format() that ignores the number and renders the scripted display
  // string instead, since these KPI values are pre-formatted strings
  // ("$4.2M"), not raw numbers, in the tour script.
  const kpis: KpiItem[] = scene.kpis.map((k, i) => ({
    label: k.label,
    value: 1,
    icon: (['deals', 'volume', 'org', 'financing'] as const)[i],
    tint: 'var(--blue)',
    format: () => k.value,
  }))

  return (
    <>
      <Topbar crumbs={[{ label: scene.sceneLabel }]} />
      <div style={{ padding: '24px 24px 0' }}>
        <DashboardHeader title={scene.heading} subtitle={scene.subheading} />

        <button
          type="button"
          onClick={onAdvance}
          className="ai-insight-banner ai-sheen"
          style={{ alignItems: 'flex-start', width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', marginBottom: 24 }}
        >
          <div className="ai-insight-banner-icon ai-breathe">✦</div>
          <div style={{ flex: 1 }}>
            <div className="ai-insight-banner-label">{scene.insight.title}</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55 }}>{scene.insight.body}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginTop: 2 }}>
            <span style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid var(--blue)', color: 'var(--blue)', fontSize: 12, whiteSpace: 'nowrap' }}>
              Source a supplier →
            </span>
          </div>
        </button>

        <PassportBanner passport={MOCK_PASSPORT} loading={false} />
        <ActionQueueStrip cards={MOCK_ACTION_CARDS} loading={false} onCardClick={onAdvance} />
        <KpiStrip kpis={kpis} loading={false} />

        <div className="split-65" style={{ marginBottom: 40 }}>
          <div className="card">
            <div className="card-head">
              <span>Active Deals</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <DealTable
                deals={MOCK_DEALS}
                loading={false}
                emptyTitle="No active deals"
                emptySub=""
                emptyCta={null}
                onRowClick={onAdvance}
              />
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <span>My Listings</span>
            </div>
            <div className="card-body">
              <div style={{ fontSize: 13, color: 'var(--gray)' }}>No open listings yet — Strike AI is about to change that.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
