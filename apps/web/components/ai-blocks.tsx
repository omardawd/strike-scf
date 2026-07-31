'use client'
import type React from 'react'
import { useT } from '@/lib/i18n/locale-context'
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
  LineChart as RechartsLineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
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

interface ChartBlock {
  type: 'chart'
  chart_type: 'pie' | 'bar' | 'line'
  title?: string
  data: { label: string; value: number }[]
}

interface DocumentBlock {
  type: 'document'
  title: string
  filename?: string
  download_url: string
  description?: string
}

type StrikeBlockData = StatRowBlock | ComparisonBlock | AlertBlock | ChartBlock | DocumentBlock

const CHART_COLORS = ['var(--blue)', 'var(--color-green)', 'var(--color-amber)', 'var(--color-purple)', 'var(--color-red)', 'var(--gray)']

function fmtChartValue(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString('en-US')
}

function Chart({ block }: { block: ChartBlock }) {
  const data = block.data ?? []
  return (
    <div style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--white)' }}>
      {block.title && (
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', borderBottom: '1px solid var(--border)' }}>
          {block.title}
        </div>
      )}
      <div style={{ padding: '12px 14px 6px', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          {block.chart_type === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={75} label={(d: { label?: string; percent?: number }) => `${d.label} ${((d.percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtChartValue(Number(v))} />
            </PieChart>
          ) : block.chart_type === 'bar' ? (
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" fontSize={11} stroke="var(--gray)" tickLine={false} />
              <YAxis fontSize={11} stroke="var(--gray)" tickLine={false} axisLine={false} tickFormatter={fmtChartValue} width={40} />
              <Tooltip formatter={(v) => fmtChartValue(Number(v))} />
              <Bar dataKey="value" fill="var(--blue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : (
            <RechartsLineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" fontSize={11} stroke="var(--gray)" tickLine={false} />
              <YAxis fontSize={11} stroke="var(--gray)" tickLine={false} axisLine={false} tickFormatter={fmtChartValue} width={40} />
              <Tooltip formatter={(v) => fmtChartValue(Number(v))} />
              <Line type="monotone" dataKey="value" stroke="var(--blue)" strokeWidth={2} dot={{ r: 3 }} />
            </RechartsLineChart>
          )}
        </ResponsiveContainer>
      </div>
      {block.chart_type === 'pie' && data.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '0 14px 10px', fontSize: 11, color: 'var(--gray)' }}>
          {data.map((d, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], display: 'inline-block' }} />
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DocumentCard({ block }: { block: DocumentBlock }) {
  const t = useT()
  return (
    <div style={{
      margin: '10px 0', display: 'flex', alignItems: 'center', gap: 12,
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', background: 'var(--white)',
    }}>
      <div style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: 8, background: 'var(--blue-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--blue)',
      }}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 2.5h7l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1v-13a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M12 2.5v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{block.title}</div>
        {(block.description || block.filename) && (
          <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {block.description ?? block.filename}
          </div>
        )}
      </div>
      <a
        href={block.download_url}
        download={block.filename}
        target="_blank"
        rel="noreferrer"
        className="btn btn-primary btn-sm"
        style={{ flexShrink: 0 }}
      >
        {t('txnDetail.download')}
      </a>
    </div>
  )
}

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
    case 'chart': return <Chart key={keyProp} block={data} />
    case 'document': return <DocumentCard key={keyProp} block={data} />
    default: return null
  }
}

/**
 * Splits plain (non-markdown) text on [[STRIKE_BLOCK:...]] directives —
 * for surfaces like Strike Rooms that render message content as-is rather
 * than through a markdown pipeline. Text segments keep whitespace via
 * white-space: pre-wrap instead of being handed to a markdown renderer.
 */
export function renderTextWithStrikeBlocks(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  STRIKE_BLOCK_RE.lastIndex = 0
  while ((m = STRIKE_BLOCK_RE.exec(text)) !== null) {
    const before = text.slice(last, m.index).trim()
    if (before) out.push(<span key={`t-${last}`} style={{ whiteSpace: 'pre-wrap' }}>{before}</span>)
    out.push(<StrikeBlockFromJson key={`b-${m.index}`} keyProp={`b-${m.index}`} raw={m[1]!} />)
    last = m.index + m[0].length
  }
  const remainder = text.slice(last).trim()
  if (remainder) out.push(<span key={`t-${last}`} style={{ whiteSpace: 'pre-wrap' }}>{remainder}</span>)
  return out
}
