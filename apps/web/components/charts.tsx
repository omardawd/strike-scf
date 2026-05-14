'use client'
import React from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'

export type Period = 'daily' | 'weekly' | 'monthly'

function fmtVal(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function PeriodToggle({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--color-bg-2)', borderRadius: 6, padding: 2 }}>
      {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          style={{
            padding: '3px 10px', borderRadius: 4, border: 'none', fontSize: 10.5,
            fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            background: value === p ? 'var(--color-card)' : 'transparent',
            color: value === p ? 'var(--color-ink-1)' : 'var(--color-ink-4)',
            boxShadow: value === p ? '0 1px 2px var(--color-shadow)' : 'none',
          }}
        >
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  )
}

export interface VolumePoint { label: string; value: number; count?: number }

export function VolumeChart({
  data,
  height = 140,
  color = '#2563EB',
}: {
  data: VolumePoint[]
  height?: number
  color?: string
}) {
  const hasData = (data ?? []).some(d => d.value > 0)
  if (!hasData) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>
        No data yet
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#9C9890' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis hide />
        <Tooltip
          contentStyle={{
            background: '#fff',
            border: '1px solid #E2DFD8',
            borderRadius: 6,
            fontSize: 11,
            color: '#0F0F0F',
            padding: '4px 10px',
          }}
          formatter={(v: unknown) => [fmtVal(v as number), 'Volume']}
          labelStyle={{ color: '#6B6963', marginBottom: 2 }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={color}
          fillOpacity={0.07}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: color }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

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
          <span style={{ fontSize: 11, color: 'var(--color-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
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
      <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>
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
