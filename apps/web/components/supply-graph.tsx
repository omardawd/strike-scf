'use client'
import { useState, useEffect } from 'react'

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
  label?: string
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

const NODE_COLORS = {
  bank: { fill: 'var(--ink)', stroke: 'var(--ink)', text: 'white', r: 28 },
  anchor: { fill: 'var(--white)', stroke: 'var(--border)', text: 'var(--ink)', r: 22 },
  supplier: {
    green: { fill: 'rgba(5,150,105,0.1)', stroke: '#059669' },
    amber: { fill: 'rgba(217,119,6,0.1)', stroke: '#D97706' },
    red: { fill: 'rgba(220,38,38,0.1)', stroke: '#DC2626' },
    default: { fill: 'var(--offwhite)', stroke: 'var(--border)' },
    r: 18,
    text: 'var(--ink)',
  },
}

function layoutNodes(nodes: GraphNode[], edges: GraphEdge[]): PositionedNode[] {
  const positioned = nodes.map(n => ({ ...n, x: 300, y: 200 })) as PositionedNode[]

  const bankNode = positioned.find(n => n.type === 'bank')
  const anchors = positioned.filter(n => n.type === 'anchor')
  const suppliers = positioned.filter(n => n.type === 'supplier')

  if (bankNode) {
    bankNode.x = 300
    bankNode.y = 200
  }

  anchors.forEach((a, i) => {
    const angle = (i / anchors.length) * 2 * Math.PI - Math.PI / 2
    a.x = 300 + 140 * Math.cos(angle)
    a.y = 200 + 140 * Math.sin(angle)
  })

  suppliers.forEach(s => {
    const anchorEdge = edges.find(e => e.to === s.id && e.type === 'buys_from')
    const anchor = anchors.find(a => a.id === anchorEdge?.from)
    if (anchor) {
      const anchorAngle = Math.atan2(anchor.y - 200, anchor.x - 300)
      const suppliersForAnchor = suppliers.filter(ss => {
        const ae = edges.find(e => e.to === ss.id && e.type === 'buys_from')
        return ae?.from === anchor.id
      })
      const supplierIndex = suppliersForAnchor.indexOf(s)
      const spread = 0.4
      const offset = (supplierIndex - 0.5) * spread
      const supplierAngle = anchorAngle + offset
      s.x = 300 + 260 * Math.cos(supplierAngle)
      s.y = 200 + 260 * Math.sin(supplierAngle)
    } else {
      s.x = 300
      s.y = 200
    }
  })

  return positioned
}

export function SupplyGraph({ bankId: _bankId }: { bankId: string }) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/graph')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setGraphData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{
        border: '1px solid var(--border)',
        background: 'var(--white)',
        padding: 40,
        textAlign: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--gray)',
      }}>
        Loading supply graph…
      </div>
    )
  }

  if (!graphData || graphData.nodes.length <= 1) {
    return (
      <div style={{
        border: '1px solid var(--border)',
        background: 'var(--white)',
        padding: 40,
        textAlign: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--gray)',
      }}>
        No supply network data yet
      </div>
    )
  }

  const positionedNodes = layoutNodes(graphData.nodes, graphData.edges)
  const edges = graphData.edges

  return (
    <div style={{ border: '1px solid var(--border)', background: 'var(--white)', overflow: 'hidden' }}>

      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
        }}>Supply Graph</span>
        <div style={{
          display: 'flex', gap: 16,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
        }}>
          {[
            { dot: '#059669', label: 'Low risk' },
            { dot: '#D97706', label: 'Med risk' },
            { dot: '#DC2626', label: 'High risk' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: l.dot }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      <svg viewBox="0 0 600 400" style={{ width: '100%', height: 340 }}>

        {edges.map((edge, i) => {
          const from = positionedNodes.find(n => n.id === edge.from)
          const to = positionedNodes.find(n => n.id === edge.to)
          if (!from || !to) return null
          return (
            <line
              key={i}
              x1={from.x} y1={from.y}
              x2={to.x} y2={to.y}
              stroke={edge.type === 'funds' ? 'rgba(0,82,255,0.15)' : 'var(--border)'}
              strokeWidth={edge.type === 'funds' ? 1.5 : 1}
              strokeDasharray={edge.type === 'funds' ? '4 3' : 'none'}
            />
          )
        })}

        {positionedNodes.map(node => {
          const isSelected = selectedNode?.id === node.id
          const isHovered = hoveredNode === node.id

          const supplierColors = node.type === 'supplier'
            ? (node.risk_tier === 'green'
                ? NODE_COLORS.supplier.green
                : node.risk_tier === 'amber'
                ? NODE_COLORS.supplier.amber
                : node.risk_tier === 'red'
                ? NODE_COLORS.supplier.red
                : NODE_COLORS.supplier.default)
            : NODE_COLORS.supplier.default

          const fill = node.type === 'bank'
            ? NODE_COLORS.bank.fill
            : node.type === 'anchor'
            ? (isSelected || isHovered ? 'rgba(0,82,255,0.06)' : NODE_COLORS.anchor.fill)
            : supplierColors.fill

          const stroke = node.type === 'bank'
            ? NODE_COLORS.bank.stroke
            : node.type === 'anchor'
            ? (isSelected ? 'var(--blue)' : 'var(--border)')
            : supplierColors.stroke

          const r = node.type === 'bank'
            ? NODE_COLORS.bank.r
            : node.type === 'anchor'
            ? NODE_COLORS.anchor.r
            : NODE_COLORS.supplier.r

          const initials = node.label
            ?.split(' ')
            .slice(0, 2)
            .map((w: string) => w[0])
            .join('')
            .toUpperCase()

          return (
            <g
              key={node.id}
              onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={node.x} cy={node.y} r={r}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected ? 2 : 1}
                style={{
                  transition: 'all 0.15s',
                  filter: isHovered ? 'drop-shadow(0 2px 8px rgba(0,0,0,0.12))' : 'none',
                }}
              />
              <text
                x={node.x} y={node.y}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: node.type === 'bank' ? 10 : 9,
                  fill: node.type === 'bank' ? 'white' : 'var(--ink)',
                  letterSpacing: '0.05em',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {initials}
              </text>
              {node.type !== 'bank' && (
                <text
                  x={node.x}
                  y={node.y + r + 10}
                  textAnchor="middle"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8,
                    fill: 'var(--gray)',
                    letterSpacing: '0.06em',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                >
                  {node.label?.split(' ')[0]}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {selectedNode && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--offwhite)',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13, fontWeight: 500,
              color: 'var(--ink)',
              marginBottom: 2,
            }}>{selectedNode.label}</div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
            }}>
              {selectedNode.type}
              {selectedNode.country && ` · ${selectedNode.country}`}
              {selectedNode.risk_score !== undefined && ` · Risk ${selectedNode.risk_score}/100`}
            </div>
          </div>
          {selectedNode.type !== 'bank' && (
            <a href="#" className="btn btn-ghost btn-sm">View →</a>
          )}
        </div>
      )}
    </div>
  )
}
