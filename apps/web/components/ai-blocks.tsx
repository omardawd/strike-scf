'use client'
// Structured response blocks Strike AI can render inline in its chat replies —
// the same mechanism the [LISTING_CARD:{id}] directive already used, generalized.
// Claude picks a block TYPE and supplies DATA via a directive in its own text;
// it never controls markup. Every block here is a real component wearing the
// existing design tokens (app/globals.css), not model-generated HTML/CSS —
// see the "Autonomous Agent Manager" / AI features sections in CLAUDE.md.
//
// Directive syntax (parsed by STRIKE_BLOCK_RE, on its own line in the reply):
//   [[STRIKE_BLOCK:{"type":"stat_row","stats":[{"label":"Net Cash","value":"$850,000"}]}]]
// JSON must be compact (no pretty-printing) so the "}]]" terminator stays unambiguous.

export const STRIKE_BLOCK_RE = /\[\[STRIKE_BLOCK:(\{[\s\S]*?\})\]\]/g

type Tone = 'default' | 'good' | 'warn' | 'bad'

const TONE_COLOR: Record<Tone, string> = {
  default: 'var(--ink)',
  good: 'var(--color-green)',
  warn: 'var(--color-amber)',
  bad: 'var(--color-red)',
}
const TONE_BG: Record<Tone, string> = {
  default: 'var(--offwhite)',
  good: '#EDFAF4',
  warn: '#FEF3C7',
  bad: '#FEE2E2',
}

interface StatRowBlock {
  type: 'stat_row'
  title?: string
  stats: { label: string; value: string; sublabel?: string; tone?: Tone }[]
}

interface ComparisonBlock {
  type: 'comparison'
  title?: string
  left: { label: string; items: { label: string; value: string }[] }
  right: { label: string; items: { label: string; value: string }[] }
}

interface AlertBlock {
  type: 'alert'
  tone: Tone
  title: string
  body?: string
}

type StrikeBlockData = StatRowBlock | ComparisonBlock | AlertBlock

function StatRow({ block }: { block: StatRowBlock }) {
  return (
    <div style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--white)' }}>
      {block.title && (
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', borderBottom: '1px solid var(--border)' }}>
          {block.title}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {block.stats.map((s, i) => (
          <div key={i} style={{ flex: '1 1 120px', padding: '10px 14px', borderRight: i < block.stats.length - 1 ? '1px solid var(--border)' : undefined }}>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: TONE_COLOR[s.tone ?? 'default'] }}>{s.value}</div>
            {s.sublabel && <div style={{ fontSize: 10.5, color: 'var(--gray-soft)', marginTop: 1 }}>{s.sublabel}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ComparisonColumn({ col }: { col: ComparisonBlock['left'] }) {
  return (
    <div style={{ flex: 1, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>{col.label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {col.items.map((it, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
            <span style={{ color: 'var(--gray)' }}>{it.label}</span>
            <span style={{ fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Comparison({ block }: { block: ComparisonBlock }) {
  return (
    <div style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--white)' }}>
      {block.title && (
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', borderBottom: '1px solid var(--border)' }}>
          {block.title}
        </div>
      )}
      <div style={{ display: 'flex' }}>
        <ComparisonColumn col={block.left} />
        <div style={{ width: 1, background: 'var(--border)' }} />
        <ComparisonColumn col={block.right} />
      </div>
    </div>
  )
}

function Alert({ block }: { block: AlertBlock }) {
  return (
    <div style={{
      margin: '10px 0', padding: '10px 14px', borderRadius: 'var(--radius-sm)',
      background: TONE_BG[block.tone], borderLeft: `3px solid ${TONE_COLOR[block.tone]}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: TONE_COLOR[block.tone] }}>{block.title}</div>
      {block.body && <div style={{ fontSize: 12.5, color: 'var(--ink-soft, var(--ink))', marginTop: 3, lineHeight: 1.5 }}>{block.body}</div>}
    </div>
  )
}

/** Parses a raw JSON blob from a STRIKE_BLOCK directive and renders the matching component. Never throws — malformed data renders nothing. */
export function StrikeBlockFromJson({ raw, keyProp }: { raw: string; keyProp: string }) {
  let data: StrikeBlockData
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  switch (data.type) {
    case 'stat_row': return <StatRow key={keyProp} block={data} />
    case 'comparison': return <Comparison key={keyProp} block={data} />
    case 'alert': return <Alert key={keyProp} block={data} />
    default: return null
  }
}
