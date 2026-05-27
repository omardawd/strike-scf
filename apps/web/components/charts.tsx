'use client'
import React, { useState, useRef, useEffect, useId } from 'react'
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'

export type Period = 'daily' | 'weekly' | 'monthly'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtVal(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function niceMax(raw: number): number {
  if (raw <= 0) return 1000
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const ceil = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  const base = ceil * mag
  // guarantee at least 5% headroom so the max value isn't flush with the top
  return base < raw * 1.05 ? base * 2 : base
}

function catmullRom(pts: [number, number][]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0]![0]} ${pts[0]![1]}`
  const p = (pt: [number, number]) => `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`
  let d = `M ${p(pts[0]!)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    const cp1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const cp2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C ${p(cp1)},${p(cp2)},${p(p2)}`
  }
  return d
}

// ── PeriodToggle ──────────────────────────────────────────────────────────────

export function PeriodToggle({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--offwhite)', borderRadius: 6, padding: 2 }}>
      {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          style={{
            padding: '3px 10px', borderRadius: 4, border: 'none', fontSize: 10.5,
            fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            background: value === p ? 'var(--offwhite)' : 'transparent',
            color: value === p ? 'var(--ink)' : 'var(--gray)',
            boxShadow: value === p ? '0 1px 2px var(--color-shadow)' : 'none',
            transition: 'all 0.12s',
          }}
        >
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  )
}

// ── LineChart ─────────────────────────────────────────────────────────────────

export interface VolumePoint { label: string; value: number; count?: number }

export const LineChart = React.memo(function LineChart({
  data,
  height = 220,
  color = '#2563EB',
}: {
  data: VolumePoint[]
  height?: number
  color?: string
}) {
  const wrapRef  = useRef<HTMLDivElement>(null)
  const [width, setWidth]         = useState(0)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const safe    = (data ?? []).slice(-12)
  const hasData = safe.some(d => d.value > 0)

  // Chart margins
  const ML = 54   // left  — room for y-axis labels
  const MR = 16   // right
  const MT = 16   // top
  const MB = 36   // bottom — room for x-axis labels

  const cW = width - ML - MR
  const cH = height - MT - MB

  if (!hasData || width < 40 || cW < 10 || cH < 10) {
    return (
      <div
        ref={wrapRef}
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)', fontSize: 12 }}
      >
        {width > 0 ? 'No data yet' : null}
      </div>
    )
  }

  const rawMax  = Math.max(...safe.map(d => d.value), 1)
  const yMax    = niceMax(rawMax)
  const yTicks  = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * yMax))

  const xOf = (i: number) =>
    ML + (safe.length > 1 ? (i / (safe.length - 1)) * cW : cW / 2)
  const yOf = (v: number) => MT + (1 - v / yMax) * cH

  const pts: [number, number][] = safe.map((d, i) => [xOf(i), yOf(d.value)])
  const linePath = catmullRom(pts)
  const areaPath =
    `${linePath} ` +
    `L ${pts[pts.length - 1]![0].toFixed(1)} ${(MT + cH).toFixed(1)} ` +
    `L ${pts[0]![0].toFixed(1)} ${(MT + cH).toFixed(1)} Z`

  const gradId  = `g-${uid}`
  const clipId  = `c-${uid}`
  const animId  = `a-${uid}`
  const dataKey = safe.map(d => d.value).join('|')

  const hPt      = hoveredIdx !== null ? pts[hoveredIdx]   : null
  const hDat     = hoveredIdx !== null ? safe[hoveredIdx]  : null
  const tipRight = hPt ? hPt[0] > width * 0.6 : false

  return (
    <div ref={wrapRef} style={{ position: 'relative', userSelect: 'none' }}>
      {/* Entry animation keyframes (scoped per chart instance) */}
      <style>{`
        @keyframes ${animId} {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .${animId} { animation: ${animId} 0.38s cubic-bezier(0.22,1,0.36,1) both; }
      `}</style>

      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
            <stop offset="70%"  stopColor={color} stopOpacity="0.06" />
            <stop offset="100%" stopColor={color} stopOpacity="0.00" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={ML} y={MT - 2} width={cW} height={cH + 4} />
          </clipPath>
        </defs>

        {/* ── Y-axis grid lines + labels ── */}
        {yTicks.map((tick, i) => {
          const y = yOf(tick)
          return (
            <g key={i}>
              <line
                x1={ML} y1={y} x2={ML + cW} y2={y}
                stroke="var(--border)"
                strokeWidth={i === 0 ? 1 : 0.6}
                opacity={i === 0 ? 1 : 0.85}
              />
              {tick > 0 && (
                <text
                  x={ML - 8} y={y + 4}
                  textAnchor="end"
                  fontSize={9.5}
                  fontFamily="inherit"
                  fill="var(--gray)"
                >
                  {fmtVal(tick)}
                </text>
              )}
            </g>
          )
        })}

        {/* ── Animated area + line (re-enters when data changes) ── */}
        <g key={dataKey} className={animId}>
          <path
            d={areaPath}
            fill={`url(#${gradId})`}
            clipPath={`url(#${clipId})`}
          />
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            clipPath={`url(#${clipId})`}
          />
        </g>

        {/* ── Vertical crosshair ── */}
        {hoveredIdx !== null && pts[hoveredIdx] && (
          <line
            x1={pts[hoveredIdx]![0]} y1={MT}
            x2={pts[hoveredIdx]![0]} y2={MT + cH}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.4}
          />
        )}

        {/* ── Resting dots (small, subtle) ── */}
        {pts.map((pt, i) => (
          <circle
            key={i}
            cx={pt[0]} cy={pt[1]}
            r={hoveredIdx === i ? 0 : 2.5}
            fill="var(--offwhite)"
            stroke={color}
            strokeWidth={1.8}
            opacity={hoveredIdx === null ? 0.85 : 0.3}
            style={{ transition: 'opacity 0.15s ease, r 0.12s ease' }}
          />
        ))}

        {/* ── Active dot ── */}
        {hoveredIdx !== null && pts[hoveredIdx] && (
          <circle
            cx={pts[hoveredIdx]![0]} cy={pts[hoveredIdx]![1]}
            r={5.5}
            fill={color}
            stroke="var(--offwhite)"
            strokeWidth={2.5}
          />
        )}

        {/* ── Invisible hit zones ── */}
        {pts.map((pt, i) => {
          const x0 = i === 0               ? ML       : (pts[i - 1]![0] + pt[0]) / 2
          const x1 = i === pts.length - 1  ? ML + cW  : (pts[i + 1]![0] + pt[0]) / 2
          return (
            <rect
              key={i}
              x={x0} y={MT}
              width={Math.max(x1 - x0, 1)} height={cH}
              fill="transparent"
              style={{ cursor: 'crosshair' }}
              onMouseEnter={() => setHoveredIdx(i)}
            />
          )
        })}

        {/* ── X-axis labels ── */}
        {safe.map((d, i) => {
          if (safe.length > 8 && i % 2 !== 0 && i !== safe.length - 1) return null
          const isFirst = i === 0
          const isLast  = i === safe.length - 1
          return (
            <text
              key={i}
              x={pts[i]![0]}
              y={MT + cH + 22}
              textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
              fontSize={9.5}
              fontFamily="inherit"
              fill={hoveredIdx === i ? color : 'var(--gray)'}
              fontWeight={hoveredIdx === i ? 600 : 400}
              style={{ transition: 'fill 0.15s ease' }}
            >
              {d.label}
            </text>
          )
        })}
      </svg>

      {/* ── Floating tooltip ── */}
      {hPt && hDat && (
        <div
          style={{
            position:      'absolute',
            left:          hPt[0],
            top:           Math.max(MT + 8, hPt[1] - 6),
            transform:     tipRight
              ? 'translate(calc(-100% - 14px), -50%)'
              : 'translate(14px, -50%)',
            pointerEvents: 'none',
            zIndex:        30,
            background:    '#0F172A',
            color:         '#F8FAFC',
            borderRadius:  10,
            padding:       '10px 14px',
            minWidth:      100,
            boxShadow:     '0 8px 24px rgba(0,0,0,0.28), 0 1px 4px rgba(0,0,0,0.16)',
          }}
        >
          <div style={{
            fontSize: 9.5, fontWeight: 500, opacity: 0.55,
            letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5,
          }}>
            {hDat.label}
          </div>
          <div style={{
            fontSize: 18, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1,
          }}>
            {fmtVal(hDat.value)}
          </div>
          {hDat.count !== undefined && hDat.count > 0 && (
            <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 5, fontWeight: 400 }}>
              {hDat.count} {hDat.count === 1 ? 'transaction' : 'transactions'}
            </div>
          )}
          {/* Tiny accent bar */}
          <div style={{
            marginTop: 8, height: 2, borderRadius: 2,
            background: color, opacity: 0.7,
          }} />
        </div>
      )}
    </div>
  )
})

export const VolumeChart = LineChart

// ── ProgramPieChart ───────────────────────────────────────────────────────────

const PIE_COLORS = ['#2563EB', '#059669', '#D97706', '#7C3AED', '#0F766E', '#DC2626', '#DB2777']

export interface PieSegment { name: string; volume: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomLegend({ payload }: { payload?: any[] }) {
  if (!payload?.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ProgramPieChart({ segments }: { segments: PieSegment[] }) {
  const total = segments.reduce((s, seg) => s + seg.volume, 0)
  if (total === 0 || segments.length === 0) {
    return (
      <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)', fontSize: 12 }}>
        No data yet
      </div>
    )
  }
  const data = segments.map(s => ({ name: s.name, value: s.volume }))
  return (
    <ResponsiveContainer width="100%" height={140}>
      <PieChart>
        <Pie
          data={data}
          cx="35%"
          cy="50%"
          innerRadius={32}
          outerRadius={52}
          paddingAngle={2}
          dataKey="value"
          strokeWidth={0}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: '#fff',
            border: '1px solid #E2DFD8',
            borderRadius: 6,
            fontSize: 11,
            padding: '4px 10px',
          }}
          formatter={(v: unknown, name: unknown) => [fmtVal(v as number), name as string]}
        />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          content={<CustomLegend />}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
