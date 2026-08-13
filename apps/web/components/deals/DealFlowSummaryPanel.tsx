'use client'
import { useMemo, useState } from 'react'
import type { DealFlowData } from '@strike-scf/types'

// Read-mostly view of the deal's current flow — day-to-day accept/decline/
// complete actions live here; all authoring (add/edit/remove checkpoints,
// AI drafting, drag-and-drop) happens in the "Customize deal" canvas on
// DealRoadmap instead. Replaces the old DealWorkflowPanel + its "Add step"
// button.
export function DealFlowSummaryPanel({ dealId, flow, currentUserRole, onRefresh }: {
  dealId: string
  flow: DealFlowData | null
  currentUserRole: 'buyer' | 'supplier' | 'bank'
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null)

  const occurrencesByNode = useMemo(() => {
    const map = new Map<string, DealFlowData['occurrences']>()
    for (const o of flow?.occurrences ?? []) {
      const list = map.get(o.cycle_node_id) ?? []
      list.push(o)
      map.set(o.cycle_node_id, list)
    }
    return map
  }, [flow])

  async function request(url: string, method: string, body?: Record<string, unknown>) {
    setBusy(url)
    setError(null)
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Request failed')
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally { setBusy(null) }
  }

  const nodes = flow?.nodes ?? []

  return (
    <div className="card">
      <div className="card-head">Custom deal flow</div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--gray)', fontSize: 12, lineHeight: 1.5 }}>
          Buyer-defined checkpoints for this deal — including any repeating shipment or payment cycles.
          Use "Customize deal" above to edit the flow.
        </p>

        {error && <div style={{ color: 'var(--color-red)', fontSize: 12 }}>{error}</div>}
        {nodes.length === 0 ? (
          <div style={{ padding: '16px 0', color: 'var(--gray-soft)', fontSize: 12 }}>No flow defined yet.</div>
        ) : nodes.map((node, index) => {
          const occurrences = node.node_type === 'cycle' ? (occurrencesByNode.get(node.id) ?? []) : []
          const completedOccurrences = occurrences.filter(o => o.status === 'completed').length
          const isExpanded = expandedCycleId === node.id

          return (
            <div key={node.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 24, height: 24, borderRadius: 12, background: node.status === 'completed' ? 'var(--color-green)' : 'var(--blue-light)', color: node.status === 'completed' ? '#fff' : 'var(--blue)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {node.status === 'completed' ? '✓' : index + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>{node.title}</strong>
                  {node.node_type === 'cycle' && <span className="badge badge-draft" style={{ fontSize: 9 }}>CYCLE</span>}
                  <span className={`badge ${node.status === 'completed' ? 'badge-completed' : node.status === 'declined' ? 'badge-rejected' : node.status === 'accepted' ? 'badge-active' : 'badge-pending'}`} style={{ fontSize: 9 }}>{node.status}</span>
                  <span className="badge badge-draft" style={{ fontSize: 9 }}>{node.responsible_party}</span>
                </div>
                {node.description && <p style={{ margin: '6px 0 0', color: 'var(--gray)', fontSize: 12, lineHeight: 1.5 }}>{node.description}</p>}
                <div style={{ marginTop: 7, display: 'flex', gap: 12, color: 'var(--gray-soft)', fontSize: 10 }}>
                  {node.due_at && <span>Due {new Date(node.due_at).toLocaleDateString()}</span>}
                  {node.requires_document && <span>Document required</span>}
                  {node.node_type === 'cycle' && (
                    <span>{node.repeat_count}× every {node.repeat_interval_days}d — {completedOccurrences}/{node.repeat_count} done</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {currentUserRole === 'supplier' && node.status === 'proposed' && <>
                    <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => request(`/api/deals/${dealId}/flow/nodes/${node.id}`, 'PATCH', { response: 'accepted' })}>Accept</button>
                    <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => request(`/api/deals/${dealId}/flow/nodes/${node.id}`, 'PATCH', { response: 'declined' })}>Decline</button>
                  </>}
                  {currentUserRole !== 'bank' && node.node_type === 'step' && node.status === 'accepted' && (
                    <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => request(`/api/deals/${dealId}/flow/nodes/${node.id}/complete`, 'POST')}>Mark complete</button>
                  )}
                  {node.node_type === 'cycle' && occurrences.length > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setExpandedCycleId(prev => (prev === node.id ? null : node.id))}>
                      {isExpanded ? 'Hide occurrences' : 'View occurrences'}
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                    {occurrences.map(o => (
                      <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                        <input
                          type="checkbox"
                          checked={o.status === 'completed'}
                          disabled={!!busy || o.status === 'completed' || currentUserRole === 'bank'}
                          onChange={() => request(`/api/deals/${dealId}/flow/occurrences/${o.id}`, 'PATCH', { status: 'completed' })}
                        />
                        #{o.occurrence_index} — due {new Date(o.due_at).toLocaleDateString()}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
