'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

interface GraphNode {
  id: string
  type: 'bank' | 'anchor' | 'supplier'
  label: string
  risk_tier?: string | null
  risk_score?: number | null
  country?: string | null
  transaction_count?: number
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

interface Transform {
  tx: number
  ty: number
  scale: number
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
  const [transform, setTransform] = useState<Transform>({ tx: 0, ty: 0, scale: 1 })
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 })

  useEffect(() => {
    if (!expanded) setTransform({ tx: 0, ty: 0, scale: 1 })
  }, [expanded])

  const posNodes = layoutNodes(graphData.nodes, graphData.edges)

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!expanded) return
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }
    e.preventDefault()
  }, [expanded])

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!expanded || !dragRef.current.active) return
    const dx = e.clientX - dragRef.current.lastX
    const dy = e.clientY - dragRef.current.lastY
    dragRef.current.lastX = e.clientX
    dragRef.current.lastY = e.clientY
    const svgEl = svgRef.current
    if (!svgEl) return
    const rect = svgEl.getBoundingClientRect()
    setTransform(prev => ({
      ...prev,
      tx: prev.tx + dx * (600 / rect.width),
      ty: prev.ty + dy * (400 / rect.height),
    }))
  }, [expanded])

  const handleMouseUp = useCallback(() => { dragRef.current.active = false }, [])

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    if (!expanded) return
    e.preventDefault()
    const svgEl = svgRef.current
    if (!svgEl) return
    const rect = svgEl.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (600 / rect.width)
    const my = (e.clientY - rect.top) * (400 / rect.height)
    const factor = e.deltaY < 0 ? 1.12 : 0.9
    setTransform(prev => {
      const newScale = Math.min(Math.max(prev.scale * factor, 0.25), 8)
      const ratio = newScale / prev.scale
      return { scale: newScale, tx: mx - (mx - prev.tx) * ratio, ty: my - (my - prev.ty) * ratio }
    })
  }, [expanded])

  // Find edge data for a selected node
  const nodeEdges = selectedNode
    ? graphData.edges.filter(e => e.from === selectedNode.id || e.to === selectedNode.id)
    : []
  const nodeVolume = nodeEdges.reduce((sum, e) => sum + (e.total_volume ?? 0), 0)
  const nodeTxCount = selectedNode?.transaction_count ?? nodeEdges.reduce((sum, e) => sum + (e.transaction_count ?? 0), 0)

  const svgTransform = `translate(${transform.tx},${transform.ty}) scale(${transform.scale})`

  return (
    <>
      <svg
        ref={svgRef}
        viewBox="0 0 600 400"
        style={{
          width: '100%',
          height: expanded ? '100%' : 340,
          cursor: expanded ? (dragRef.current.active ? 'grabbing' : 'grab') : 'default',
          display: 'block',
          background: C.bg,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
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

        {/* Background grid */}
        <rect width="600" height="400" fill={C.bg} />
        <rect width="600" height="400" fill="url(#grid)" opacity="0.4" />

        <g transform={svgTransform}>
          {/* Edges */}
          {graphData.edges.map((edge, i) => {
            const from = posNodes.find(n => n.id === edge.from)
            const to   = posNodes.find(n => n.id === edge.to)
            if (!from || !to) return null

            if (edge.type === 'funds') {
              return (
                <g key={i}>
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={C.blue} strokeWidth={1} opacity={0.15}
                  />
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={C.blue} strokeWidth={1.5} strokeDasharray="6 4" opacity={0.55}
                  >
                    <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.2s" repeatCount="indefinite" />
                  </line>
                </g>
              )
            }
            return (
              <line
                key={i}
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={C.borderHi} strokeWidth={1} opacity={0.6}
              />
            )
          })}

          {/* Nodes */}
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
              <NodeShape
                node={node}
                isSelected={selectedNode?.id === node.id}
                isHovered={hoveredNode === node.id}
              />
            </g>
          ))}
        </g>

        {/* Deselect on canvas click */}
        <rect
          width="600" height="400" fill="transparent"
          onClick={() => setSelectedNode(null)}
          style={{ pointerEvents: selectedNode ? 'auto' : 'none' }}
        />
      </svg>

      {/* Analytics panel */}
      {selectedNode && (
        <div style={{
          borderTop: `1px solid ${C.border}`,
          background: C.bgNode,
          padding: '14px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.14em',
                  color: selectedNode.type === 'bank' ? C.blue : C.textDim,
                  border: `1px solid ${selectedNode.type === 'bank' ? C.blue : C.borderHi}`,
                  padding: '1px 6px', borderRadius: 2,
                }}>
                  {selectedNode.type.toUpperCase()}
                </span>
                {selectedNode.risk_tier && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.14em',
                    color: tierStroke(selectedNode.risk_tier),
                    border: `1px solid ${tierStroke(selectedNode.risk_tier)}`,
                    padding: '1px 6px', borderRadius: 2,
                  }}>
                    TIER {selectedNode.risk_tier}
                  </span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: '0.02em', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedNode.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px 16px' }}>
                {[
                  { label: 'RISK SCORE', value: selectedNode.risk_score != null ? `${selectedNode.risk_score}/100` : '—' },
                  { label: 'COUNTRY',    value: selectedNode.country?.toUpperCase() ?? '—' },
                  { label: 'TXN COUNT',  value: nodeTxCount > 0 ? String(nodeTxCount) : '—' },
                  { label: 'VOLUME',     value: nodeVolume > 0 ? fmtVol(nodeVolume) : '—' },
                ].map(stat => (
                  <div key={stat.label}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', color: C.textDim, marginBottom: 3, textTransform: 'uppercase' }}>{stat.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: C.text, letterSpacing: '0.04em' }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>
            {selectedNode.type !== 'bank' && (
              <a
                href="#"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: C.blue, border: `1px solid ${C.blue}`, padding: '5px 12px', textDecoration: 'none', flexShrink: 0 }}
              >
                VIEW →
              </a>
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
      borderBottom: `1px solid ${C.border}`,
      background: C.bgNode,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.text }}>
          SUPPLY NETWORK
        </span>
        {stats && (
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { label: 'ANCHORS',   value: String(stats.total_anchors) },
              { label: 'SUPPLIERS', value: String(stats.total_suppliers) },
              { label: 'VOLUME',    value: stats.total_volume > 0 ? fmtVol(stats.total_volume) : '—' },
              { label: 'AT RISK',   value: String(stats.at_risk_count), warn: stats.at_risk_count > 0 },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', color: C.textDim }}>{s.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: s.warn ? C.red : C.text, fontWeight: 600 }}>{s.value}</span>
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
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: l.dot }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', color: C.textDim }}>TIER {l.label}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          style={{
            background: 'none',
            border: `1px solid ${C.border}`,
            padding: '3px 8px',
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: C.textDim,
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
