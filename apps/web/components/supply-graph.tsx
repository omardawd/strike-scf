'use client'
import { useState, useEffect, useRef } from 'react'

interface GraphNode {
  id: string
  type: 'bank' | 'anchor' | 'supplier'
  label: string
  risk_tier?: string | null
  risk_score?: number | null
  country?: string | null
  country_of_origin?: string | null
  transaction_count?: number
  kyb_status?: string | null
  performance_tier?: string | null
}

interface PositionedNode extends GraphNode {
  x: number
  y: number
}

interface GraphEdge {
  from: string
  to: string
  type: 'funds' | 'buys_from'
  transaction_count?: number
  total_volume?: number
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: {
    total_anchors: number
    total_suppliers: number
    total_volume: number
    at_risk_count: number
  }
}

// Bloomberg terminal palette
const C = {
  bg:       '#080c12',
  bgNode:   '#0d1420',
  text:     '#baccdc',
  textDim:  '#2e4055',
  blue:     '#1a5dff',
  blueDim:  'rgba(26,93,255,0.2)',
  green:    '#00c87a',
  greenDim: 'rgba(0,200,122,0.1)',
  amber:    '#e89000',
  amberDim: 'rgba(232,144,0,0.1)',
  red:      '#e83344',
  redDim:   'rgba(232,51,68,0.1)',
  border:   '#18253a',
  borderHi: '#253850',
}

function tierStroke(tier: string | null | undefined): string {
  if (tier === 'A') return C.green
  if (tier === 'B') return C.green
  if (tier === 'C') return C.amber
  if (tier === 'D') return C.red
  return C.borderHi
}

function tierFill(tier: string | null | undefined): string {
  if (tier === 'A' || tier === 'B') return C.greenDim
  if (tier === 'C') return C.amberDim
  if (tier === 'D') return C.redDim
  return C.bgNode
}

function tierLabel(tier: string | null | undefined): string {
  return tier ?? '—'
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function fmtVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${n}`
}

// Node dimensions (w × h, centered on x/y)
const DIM = {
  bank:     { w: 76, h: 34 },
  anchor:   { w: 132, h: 42 },
  supplier: { w: 116, h: 36 },
}

function layoutNodes(nodes: GraphNode[], edges: GraphEdge[]): PositionedNode[] {
  const pos = nodes.map(n => ({ ...n, x: 300, y: 200 })) as PositionedNode[]

  const bank      = pos.find(n => n.type === 'bank')
  const anchors   = pos.filter(n => n.type === 'anchor')
  const suppliers = pos.filter(n => n.type === 'supplier')

  if (bank) { bank.x = 300; bank.y = 200 }

  anchors.forEach((a, i) => {
    const angle = (i / Math.max(1, anchors.length)) * 2 * Math.PI - Math.PI / 2
    a.x = 300 + 160 * Math.cos(angle)
    a.y = 200 + 130 * Math.sin(angle)
  })

  suppliers.forEach(s => {
    const edge = edges.find(e => e.to === s.id && e.type === 'buys_from')
    const anchor = anchors.find(a => a.id === edge?.from)
    if (!anchor) { s.x = 300; s.y = 340; return }

    const anchorAngle = Math.atan2(anchor.y - 200, anchor.x - 300)
    const group = suppliers.filter(ss => {
      const ae = edges.find(e => e.to === ss.id && e.type === 'buys_from')
      return ae?.from === anchor.id
    })
    const idx = group.indexOf(s)
    const spread = 0.42
    const offset = group.length > 1 ? (idx - (group.length - 1) / 2) * spread : 0
    s.x = 300 + 290 * Math.cos(anchorAngle + offset)
    s.y = 200 + 240 * Math.sin(anchorAngle + offset)
  })

  return pos
}

function NodeShape({
  node,
  isSelected,
  isHovered,
}: {
  node: PositionedNode
  isSelected: boolean
  isHovered: boolean
}) {
  const dim = DIM[node.type]
  const x = node.x - dim.w / 2
  const y = node.y - dim.h / 2

  if (node.type === 'bank') {
    const glow = isSelected || isHovered
    return (
      <g>
        {glow && (
          <rect
            x={x - 3} y={y - 3} width={dim.w + 6} height={dim.h + 6}
            fill="none" stroke={C.blue} strokeWidth={1} opacity={0.4} rx={4}
          />
        )}
        <rect x={x} y={y} width={dim.w} height={dim.h} fill={C.blue} stroke={C.blue} strokeWidth={1} rx={3} />
        <text
          x={node.x} y={node.y - 5}
          textAnchor="middle" dominantBaseline="middle"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'white', letterSpacing: '0.14em', fontWeight: 700 }}
        >
          {truncate(node.label.toUpperCase().replace(/ BANK$| FINANCIAL$/, ''), 10)}
        </text>
        <text
          x={node.x} y={node.y + 7}
          textAnchor="middle" dominantBaseline="middle"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 7, fill: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}
        >
          BANK
        </text>
      </g>
    )
  }

  const stroke = isSelected ? C.blue : (isHovered ? C.borderHi : tierStroke(node.risk_tier))
  const fill   = isSelected ? C.blueDim : tierFill(node.risk_tier)
  const strokeW = isSelected ? 1.5 : 1
  const tier   = tierLabel(node.risk_tier)
  const tierCol = isSelected ? C.blue : tierStroke(node.risk_tier)

  if (node.type === 'anchor') {
    return (
      <g>
        {(isSelected || isHovered) && (
          <rect x={x - 3} y={y - 3} width={dim.w + 6} height={dim.h + 6} fill="none" stroke={stroke} strokeWidth={0.5} opacity={0.5} rx={4} />
        )}
        <rect x={x} y={y} width={dim.w} height={dim.h} fill={fill} stroke={stroke} strokeWidth={strokeW} rx={3} />
        <text
          x={x + 8} y={node.y - 5}
          textAnchor="start" dominantBaseline="middle"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: C.text, letterSpacing: '0.06em', fontWeight: 600 }}
        >
          {truncate(node.label.toUpperCase(), 14)}
        </text>
        <text
          x={x + 8} y={node.y + 7}
          textAnchor="start" dominantBaseline="middle"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 7, fill: C.textDim, letterSpacing: '0.08em' }}
        >
          ANCHOR
          {node.country ? ` · ${node.country.toUpperCase()}` : ''}
        </text>
        {tier !== '—' && (
          <>
            <rect x={x + dim.w - 22} y={y + 6} width={16} height={10} fill="none" stroke={tierCol} strokeWidth={0.8} rx={1} />
            <text
              x={x + dim.w - 14} y={y + 11}
              textAnchor="middle" dominantBaseline="middle"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 7, fill: tierCol, letterSpacing: '0.06em', fontWeight: 700 }}
            >
              {tier}
            </text>
          </>
        )}
      </g>
    )
  }

  // Supplier
  return (
    <g>
      {(isSelected || isHovered) && (
        <rect x={x - 3} y={y - 3} width={dim.w + 6} height={dim.h + 6} fill="none" stroke={stroke} strokeWidth={0.5} opacity={0.5} rx={4} />
      )}
      <rect x={x} y={y} width={dim.w} height={dim.h} fill={fill} stroke={stroke} strokeWidth={strokeW} rx={2} />
      <text
        x={x + 7} y={node.y - 5}
        textAnchor="start" dominantBaseline="middle"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, fill: C.text, letterSpacing: '0.04em' }}
      >
        {truncate(node.label.toUpperCase(), 12)}
      </text>
      <text
        x={x + 7} y={node.y + 6}
        textAnchor="start" dominantBaseline="middle"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 7, fill: C.textDim, letterSpacing: '0.06em' }}
      >
        {node.country ? node.country.toUpperCase() : 'SUPPLIER'}
      </text>
      {tier !== '—' && (
        <>
          <rect x={x + dim.w - 20} y={y + 7} width={14} height={9} fill="none" stroke={tierCol} strokeWidth={0.7} rx={1} />
          <text
            x={x + dim.w - 13} y={y + 11.5}
            textAnchor="middle" dominantBaseline="middle"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 6.5, fill: tierCol, letterSpacing: '0.06em', fontWeight: 700 }}
          >
            {tier}
          </text>
        </>
      )}
    </g>
  )
}

function GraphCanvas({ graphData, expanded }: { graphData: GraphData; expanded: boolean }) {
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!expanded) setTransform({ x: 0, y: 0, scale: 1 })
  }, [expanded])

  const posNodes = layoutNodes(graphData.nodes, graphData.edges)

  const nodeEdges = selectedNode
    ? graphData.edges.filter(e => e.from === selectedNode.id || e.to === selectedNode.id)
    : []
  const nodeVolume = nodeEdges.reduce((sum, e) => sum + (e.total_volume ?? 0), 0)
  const nodeTxCount = selectedNode?.transaction_count ?? nodeEdges.reduce((sum, e) => sum + (e.transaction_count ?? 0), 0)

  const svgTransform = `translate(${transform.x},${transform.y}) scale(${transform.scale})`

  return (
    <>
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox="0 0 600 400"
          style={{
            width: '100%',
            height: expanded ? '100%' : 340,
            cursor: dragging ? 'grabbing' : 'grab',
            display: 'block',
            background: C.bg,
          }}
          onWheel={e => {
            e.preventDefault()
            const delta = e.deltaY > 0 ? 0.9 : 1.1
            setTransform(prev => ({
              ...prev,
              scale: Math.min(3, Math.max(0.3, prev.scale * delta)),
            }))
          }}
          onClick={e => {
            const target = e.target as SVGElement
            const tag = target.tagName.toLowerCase()
            if (tag === 'svg' || tag === 'line' || (tag === 'rect' && !target.closest('g'))) {
              setSelectedNode(null)
            }
          }}
          onPointerDown={e => {
            const target = e.target as Element
            const isBackground = target === svgRef.current ||
              (target.tagName === 'rect' && !target.closest('g')) ||
              target.tagName === 'line'
            if (isBackground) {
              setDragging(true)
              setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y })
              svgRef.current?.setPointerCapture(e.pointerId)
            }
          }}
          onPointerMove={e => {
            if (!dragging) return
            setTransform(prev => ({
              ...prev,
              x: e.clientX - dragStart.x,
              y: e.clientY - dragStart.y,
            }))
          }}
          onPointerUp={() => setDragging(false)}
        >
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke={C.bg} strokeWidth="0.5" opacity="0.5" />
            </pattern>
            <filter id="glow-blue">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <rect width="600" height="400" fill={C.bg} />
          <rect width="600" height="400" fill="url(#grid)" opacity="0.4" />

          <g transform={svgTransform}>
            {graphData.edges.map((edge, i) => {
              const from = posNodes.find(n => n.id === edge.from)
              const to   = posNodes.find(n => n.id === edge.to)
              if (!from || !to) return null

              if (edge.type === 'funds') {
                return (
                  <g key={i}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={C.blue} strokeWidth={1} opacity={0.15} />
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={C.blue} strokeWidth={1.5} strokeDasharray="6 4" opacity={0.55}>
                      <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.2s" repeatCount="indefinite" />
                    </line>
                  </g>
                )
              }
              return <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={C.borderHi} strokeWidth={1} opacity={0.6} />
            })}

            {posNodes.map(node => (
              <g
                key={node.id}
                style={{ cursor: 'pointer' }}
                onClick={e => {
                  e.stopPropagation()
                  setSelectedNode(selectedNode?.id === node.id ? null : node)
                }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <NodeShape node={node} isSelected={selectedNode?.id === node.id} isHovered={hoveredNode === node.id} />
              </g>
            ))}
          </g>

        </svg>

        {/* Zoom controls */}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(['+', '−', '⊙'] as const).map((btn, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (btn === '⊙') {
                  setTransform({ x: 0, y: 0, scale: 1 })
                } else {
                  setTransform(prev => ({
                    ...prev,
                    scale: Math.min(3, Math.max(0.3, prev.scale * (btn === '+' ? 1.2 : 0.8))),
                  }))
                }
              }}
              style={{
                width: 28, height: 28,
                background: C.bgNode,
                border: `1px solid ${C.borderHi}`,
                color: C.text,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {btn}
            </button>
          ))}
        </div>
      </div>

      {/* Analytics panel — light theme */}
      {selectedNode && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1px',
          background: 'var(--border)',
        }}>
          {/* Left: org details */}
          <div style={{ background: 'var(--white)', padding: '14px 16px' }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.1em', color: 'var(--gray)', marginBottom: 8,
            }}>
              {selectedNode.type === 'bank' ? 'Bank' : selectedNode.type}
            </div>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600,
              color: 'var(--ink)', marginBottom: 4,
            }}>{selectedNode.label}</div>
            {selectedNode.country_of_origin && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gray)' }}>
                {selectedNode.country_of_origin}
              </div>
            )}
            {selectedNode.kyb_status && (
              <div style={{
                marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 10px', border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
                color: selectedNode.kyb_status === 'approved' ? 'var(--color-green)' : 'var(--gray)',
              }}>
                KYB: {selectedNode.kyb_status}
              </div>
            )}
          </div>

          {/* Right: metrics */}
          <div style={{ background: 'var(--white)', padding: '14px 16px' }}>
            {selectedNode.risk_score !== undefined && selectedNode.risk_score !== null && (
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
                  letterSpacing: '0.1em', color: 'var(--gray)', marginBottom: 4,
                }}>Risk Score</div>
                <div style={{
                  fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700,
                  color: selectedNode.risk_score >= 70
                    ? 'var(--color-green)'
                    : selectedNode.risk_score >= 45
                    ? 'var(--color-amber)'
                    : 'var(--color-red)',
                }}>
                  {selectedNode.risk_score}
                  <span style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 400 }}>/100</span>
                </div>
              </div>
            )}
            {nodeVolume > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
                  letterSpacing: '0.1em', color: 'var(--gray)', marginBottom: 4,
                }}>Volume Utilized</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--blue)' }}>
                  {fmtVol(nodeVolume)}
                </div>
              </div>
            )}
            {nodeTxCount > 0 && (
              <div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
                  letterSpacing: '0.1em', color: 'var(--gray)', marginBottom: 4,
                }}>Transactions</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>
                  {nodeTxCount}
                </div>
              </div>
            )}
            {selectedNode.performance_tier && (
              <div style={{ marginTop: 8 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
                  letterSpacing: '0.1em', color: 'var(--gray)', marginBottom: 4,
                }}>Performance</div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase',
                  color: selectedNode.performance_tier === 'preferred' ? 'var(--color-green)' : 'var(--ink)',
                }}>
                  {selectedNode.performance_tier}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export function SupplyGraph({ bankId: _bankId }: { bankId: string }) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetch('/api/graph')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setGraphData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!expanded) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expanded])

  const stats = graphData?.stats

  const header = (
    <div style={{
      padding: '10px 20px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--white)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink)' }}>
          Supply Network
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: 'var(--blue)',
          border: '1px solid var(--blue)', padding: '1px 6px',
          opacity: 0.75,
        }}>Beta</span>
        {stats && (
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { label: 'ANCHORS',   value: String(stats.total_anchors) },
              { label: 'SUPPLIERS', value: String(stats.total_suppliers) },
              { label: 'VOLUME',    value: stats.total_volume > 0 ? fmtVol(stats.total_volume) : '—' },
              { label: 'AT RISK',   value: String(stats.at_risk_count), warn: stats.at_risk_count > 0 },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: 'var(--gray)' }}>{s.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: s.warn ? 'var(--color-red)' : 'var(--ink)', fontWeight: 600 }}>{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { dot: C.green, label: 'A/B' },
            { dot: C.amber, label: 'C' },
            { dot: C.red,   label: 'D' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.dot }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', color: 'var(--ink)' }}>TIER {l.label}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            padding: '3px 8px',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
            cursor: 'pointer',
          }}
          title={expanded ? 'Collapse (Esc)' : 'Expand'}
        >
          {expanded ? '⤡ COLLAPSE' : '⤢ EXPAND'}
        </button>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div style={{ background: C.bgNode, border: `1px solid ${C.border}`, padding: 48, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: C.textDim }}>
        LOADING SUPPLY NETWORK…
      </div>
    )
  }

  if (!graphData || graphData.nodes.length <= 1) {
    return (
      <div style={{ background: C.bgNode, border: `1px solid ${C.border}`, padding: 48, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: C.textDim }}>
        NO NETWORK DATA
      </div>
    )
  }

  if (expanded) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: C.bg, display: 'flex', flexDirection: 'column' }}>
        {header}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GraphCanvas graphData={graphData} expanded={true} />
        </div>
        <div style={{
          padding: '6px 20px', borderTop: `1px solid ${C.border}`, background: C.bgNode,
          fontFamily: 'var(--font-mono)', fontSize: 8, color: C.textDim,
          letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: 'center',
        }}>
          SCROLL TO ZOOM · DRAG TO PAN · ESC TO CLOSE
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: C.bgNode, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      {header}
      <GraphCanvas graphData={graphData} expanded={false} />
    </div>
  )
}
