'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState, BackgroundVariant, Position,
  type Node, type Edge, type Connection, type NodeMouseHandler, type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { DealFlowNode, DealFlowEdge, DealFlowCycleOccurrence, DealFlowPreset, DealFlowPresetDetail, DealFlowRoadmapStage } from '@strike-scf/types'
import { DealFlowChatPanel } from './DealFlowChatPanel'

const NODE_WIDTH_GAP = 260
const DEFAULT_ROADMAP_TITLES = ['Agreed', 'Contract', 'In Business', 'Shipped', 'Received', 'Accepted', 'Paid', 'Completed']

// Which fixed roadmap step (DealRoadmap.tsx) a checkpoint/cycle surfaces
// under — lets the buyer pick "Shipped" for a shipment cycle instead of
// relying only on the server's title-keyword guess.
const ROADMAP_STAGE_OPTIONS: { value: DealFlowRoadmapStage; label: string }[] = [
  { value: 'agreed', label: 'Agreed' },
  { value: 'contract_pending', label: 'Contract' },
  { value: 'confirmed', label: 'In Business' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'goods_received', label: 'Received' },
  { value: 'delivery_confirmed', label: 'Accepted' },
  { value: 'payment_confirmed', label: 'Paid' },
  { value: 'completed', label: 'Completed' },
]

interface CanvasNode {
  localId: string
  id?: string
  node_type: 'step' | 'cycle'
  title: string
  description: string
  responsible_party: 'buyer' | 'supplier' | 'both'
  requires_document: boolean
  due_at: string
  repeat_count: number
  repeat_interval_days: number
  anchor_date: string
  position_x: number
  position_y: number
  status: string
  roadmapStage: DealFlowRoadmapStage | ''
}

interface CanvasEdge {
  localId: string
  fromLocalId: string
  toLocalId: string
  label: string
}

function toDateInput(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function fromExisting(nodes: DealFlowNode[], index: number): CanvasNode {
  const n = nodes[index]!
  return {
    localId: n.id,
    id: n.id,
    node_type: n.node_type,
    title: n.title,
    description: n.description ?? '',
    responsible_party: n.responsible_party,
    requires_document: n.requires_document,
    due_at: toDateInput(n.due_at),
    repeat_count: n.repeat_count ?? 1,
    repeat_interval_days: n.repeat_interval_days ?? 30,
    anchor_date: n.anchor_date ?? toDateInput(new Date().toISOString()),
    position_x: n.position_x ?? index * NODE_WIDTH_GAP,
    position_y: n.position_y ?? 100,
    status: n.status,
    roadmapStage: n.roadmap_stage ?? '',
  }
}

function newNode(nodeType: 'step' | 'cycle', index: number): CanvasNode {
  return {
    localId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `new-${Date.now()}-${index}`,
    node_type: nodeType,
    title: nodeType === 'step' ? 'New step' : 'New shipment cycle',
    description: '',
    responsible_party: 'both',
    requires_document: false,
    due_at: '',
    repeat_count: 1,
    repeat_interval_days: 30,
    anchor_date: toDateInput(new Date().toISOString()),
    position_x: index * NODE_WIDTH_GAP,
    position_y: nodeType === 'cycle' ? 260 : 100,
    status: 'proposed',
    roadmapStage: '',
  }
}

export interface SaveFlowNodePayload {
  node_type: 'step' | 'cycle'
  title: string
  description?: string | null
  responsible_party: 'buyer' | 'supplier' | 'both'
  requires_document?: boolean
  due_at?: string | null
  position_x?: number | null
  position_y?: number | null
  repeat_count?: number | null
  repeat_interval_days?: number | null
  anchor_date?: string | null
  roadmap_stage?: DealFlowRoadmapStage | null
}

export function DealFlowCanvas({
  dealId, nodes: initialNodes, edges: initialEdges, occurrences, isBuyer, onClose, onSave, onCompleteOccurrence, onDraftApplied,
}: {
  dealId: string
  nodes: DealFlowNode[]
  edges: DealFlowEdge[]
  occurrences: DealFlowCycleOccurrence[]
  isBuyer: boolean
  onClose: () => void
  onSave: (nodes: SaveFlowNodePayload[], edges: { from: string; to: string; label?: string }[]) => Promise<void>
  onCompleteOccurrence: (occurrenceId: string) => Promise<void>
  onDraftApplied: () => void
}) {
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>(() => initialNodes.map((_, i) => fromExisting(initialNodes, i)))
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>(() => {
    const byId = new Map(initialNodes.map(n => [n.id, n.id]))
    return initialEdges
      .filter(e => byId.has(e.from_node_id) && byId.has(e.to_node_id))
      .map(e => ({ localId: e.id, fromLocalId: e.from_node_id, toLocalId: e.to_node_id, label: e.label ?? '' }))
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Resync local canvas state whenever the parent's underlying flow data
  // actually changes (a fresh AI draft, or completing an occurrence) —
  // WITHOUT remounting this component, so the chat panel's conversation
  // (a child of this component) survives a draft being applied.
  const previousNodesRef = useRef(initialNodes)
  useEffect(() => {
    if (previousNodesRef.current === initialNodes) return
    previousNodesRef.current = initialNodes
    setCanvasNodes(initialNodes.map((_, i) => fromExisting(initialNodes, i)))
    const byId = new Map(initialNodes.map(n => [n.id, n.id]))
    setCanvasEdges(
      initialEdges
        .filter(e => byId.has(e.from_node_id) && byId.has(e.to_node_id))
        .map(e => ({ localId: e.id, fromLocalId: e.from_node_id, toLocalId: e.to_node_id, label: e.label ?? '' }))
    )
    setExpandedId(null)
  }, [initialNodes, initialEdges])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentFlowSummary = useMemo(() => canvasNodes.map(n => n.node_type === 'cycle'
    ? `"${n.title}" (cycle, ${n.repeat_count}x every ${n.repeat_interval_days}d, ${n.responsible_party})`
    : `"${n.title}" (step, ${n.responsible_party})`
  ).join('; '), [canvasNodes])

  const occurrencesByNode = useMemo(() => {
    const map = new Map<string, DealFlowCycleOccurrence[]>()
    for (const o of occurrences) {
      const list = map.get(o.cycle_node_id) ?? []
      list.push(o)
      map.set(o.cycle_node_id, list)
    }
    return map
  }, [occurrences])

  const updateNode = useCallback((localId: string, patch: Partial<CanvasNode>) => {
    setCanvasNodes(prev => prev.map(n => (n.localId === localId ? { ...n, ...patch } : n)))
  }, [])

  const removeNode = useCallback((localId: string) => {
    setCanvasNodes(prev => prev.filter(n => n.localId !== localId))
    setCanvasEdges(prev => prev.filter(e => e.fromLocalId !== localId && e.toLocalId !== localId))
    setExpandedId(prev => (prev === localId ? null : prev))
  }, [])

  const addStep = useCallback(() => setCanvasNodes(prev => [...prev, newNode('step', prev.length)]), [])
  const addCycle = useCallback(() => setCanvasNodes(prev => [...prev, newNode('cycle', prev.length)]), [])

  const resetToDefault = useCallback(() => {
    setCanvasNodes(DEFAULT_ROADMAP_TITLES.map((title, index) => ({
      ...newNode('step', index), title, status: 'accepted',
    })))
    setCanvasEdges([])
    setExpandedId(null)
  }, [])

  // ── Saved templates ("select one they have saved for a new deal") ──────
  const [presets, setPresets] = useState<DealFlowPreset[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)

  const loadPresetList = useCallback(() => {
    fetch('/api/deal-flow-presets').then(r => r.ok ? r.json() : { presets: [] }).then(d => setPresets(d.presets ?? [])).catch(() => {})
  }, [])

  useEffect(() => { if (isBuyer) loadPresetList() }, [isBuyer, loadPresetList])

  const applyPreset = useCallback(async (presetId: string) => {
    setTemplateBusy(true)
    setTemplateError(null)
    try {
      const response = await fetch(`/api/deal-flow-presets/${presetId}`)
      const detail: DealFlowPresetDetail & { error?: string } = await response.json()
      if (!response.ok) throw new Error(detail.error ?? 'Unable to load template')

      const byPresetId = new Map<string, CanvasNode>()
      const nextNodes: CanvasNode[] = detail.nodes.map((n, i) => {
        const localId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `preset-${i}-${Date.now()}`
        const canvasNode: CanvasNode = {
          localId,
          node_type: n.node_type,
          title: n.title,
          description: n.description ?? '',
          responsible_party: n.responsible_party,
          requires_document: n.requires_document,
          due_at: '',
          repeat_count: n.repeat_count ?? 1,
          repeat_interval_days: n.repeat_interval_days ?? 30,
          anchor_date: toDateInput(new Date().toISOString()),
          position_x: n.position_x ?? i * NODE_WIDTH_GAP,
          position_y: n.position_y ?? (n.node_type === 'cycle' ? 260 : 100),
          status: 'proposed',
          roadmapStage: '',
        }
        byPresetId.set(n.id, canvasNode)
        return canvasNode
      })
      setCanvasNodes(nextNodes)
      setCanvasEdges(detail.edges.map(e => {
        const from = byPresetId.get(e.from_node_id)
        const to = byPresetId.get(e.to_node_id)
        return { localId: e.id, fromLocalId: from?.localId ?? '', toLocalId: to?.localId ?? '', label: e.label ?? '' }
      }).filter(e => e.fromLocalId && e.toLocalId))
      setExpandedId(null)
      setShowTemplates(false)
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Unable to load template')
    } finally {
      setTemplateBusy(false)
    }
  }, [])

  const deletePreset = useCallback(async (presetId: string) => {
    setTemplateBusy(true)
    try {
      await fetch(`/api/deal-flow-presets/${presetId}`, { method: 'DELETE' })
      loadPresetList()
    } finally {
      setTemplateBusy(false)
    }
  }, [loadPresetList])

  const saveAsTemplate = useCallback(async () => {
    const name = templateName.trim()
    if (!name) return
    setTemplateBusy(true)
    setTemplateError(null)
    try {
      const byLocalId = new Map(canvasNodes.map(n => [n.localId, n.title.trim()]))
      const response = await fetch('/api/deal-flow-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          nodes: canvasNodes.map(n => ({
            node_type: n.node_type,
            title: n.title.trim(),
            description: n.description || undefined,
            responsible_party: n.responsible_party,
            requires_document: n.requires_document,
            position_x: n.position_x,
            position_y: n.position_y,
            repeat_count: n.node_type === 'cycle' ? n.repeat_count : undefined,
            repeat_interval_days: n.node_type === 'cycle' ? n.repeat_interval_days : undefined,
          })),
          edges: canvasEdges
            .map(e => ({ from: byLocalId.get(e.fromLocalId), to: byLocalId.get(e.toLocalId), label: e.label || undefined }))
            .filter(e => e.from && e.to),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Unable to save template')
      setTemplateName('')
      setShowSaveTemplate(false)
      loadPresetList()
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Unable to save template')
    } finally {
      setTemplateBusy(false)
    }
  }, [templateName, canvasNodes, canvasEdges, loadPresetList])

  const flowNodes: Node[] = useMemo(() => canvasNodes.map(n => {
    const occ = n.node_type === 'cycle' && n.id ? (occurrencesByNode.get(n.id) ?? []) : []
    const completed = occ.filter(o => o.status === 'completed').length
    const isExpanded = expandedId === n.localId
    return {
      id: n.localId,
      position: { x: n.position_x, y: n.position_y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      zIndex: isExpanded ? 1000 : 0,
      data: {
        label: (
          <div style={{ width: '100%', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-display)' }}>
                {n.title}
              </span>
              {isBuyer && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeNode(n.localId) }}
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                >×</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <span className="badge badge-draft" style={{ fontSize: 9 }}>{n.responsible_party}</span>
              <span className={`badge ${n.status === 'completed' ? 'badge-completed' : n.status === 'declined' ? 'badge-rejected' : n.status === 'accepted' ? 'badge-active' : 'badge-pending'}`} style={{ fontSize: 9 }}>{n.status}</span>
            </div>
            {n.node_type === 'cycle' && (
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 6 }}>
                {n.repeat_count}× every {n.repeat_interval_days}d — {completed}/{n.repeat_count || 0} done
              </div>
            )}
            {isExpanded && (
              <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, width: 240 }}>
                <input className="input" value={n.title} disabled={!isBuyer} onChange={e => updateNode(n.localId, { title: e.target.value })} placeholder="Title" />
                <textarea className="input" rows={2} value={n.description} disabled={!isBuyer} onChange={e => updateNode(n.localId, { description: e.target.value })} placeholder="Description" />
                <select className="input" value={n.responsible_party} disabled={!isBuyer} onChange={e => updateNode(n.localId, { responsible_party: e.target.value as CanvasNode['responsible_party'] })}>
                  <option value="buyer">Buyer</option><option value="supplier">Supplier</option><option value="both">Both</option>
                </select>
                <div className="form-field">
                  <label className="field-label">Shows under roadmap step</label>
                  <select className="input" value={n.roadmapStage} disabled={!isBuyer} onChange={e => updateNode(n.localId, { roadmapStage: e.target.value as CanvasNode['roadmapStage'] })}>
                    <option value="">Auto-detect from title</option>
                    {ROADMAP_STAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <input type="checkbox" checked={n.requires_document} disabled={!isBuyer} onChange={e => updateNode(n.localId, { requires_document: e.target.checked })} />
                  Requires document
                </label>
                {n.node_type === 'step' ? (
                  <div className="form-field">
                    <label className="field-label">Due date</label>
                    <input className="input" type="date" value={n.due_at} disabled={!isBuyer} onChange={e => updateNode(n.localId, { due_at: e.target.value })} />
                  </div>
                ) : (
                  <>
                    <div className="form-row-2">
                      <div className="form-field">
                        <label className="field-label">Repeat count</label>
                        <input className="input" type="number" min={1} value={n.repeat_count} disabled={!isBuyer} onChange={e => updateNode(n.localId, { repeat_count: Number(e.target.value) || 1 })} />
                      </div>
                      <div className="form-field">
                        <label className="field-label">Every (days)</label>
                        <input className="input" type="number" min={1} value={n.repeat_interval_days} disabled={!isBuyer} onChange={e => updateNode(n.localId, { repeat_interval_days: Number(e.target.value) || 1 })} />
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="field-label">Starts</label>
                      <input className="input" type="date" value={n.anchor_date} disabled={!isBuyer} onChange={e => updateNode(n.localId, { anchor_date: e.target.value })} />
                    </div>
                    {occ.length > 0 && (
                      <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {occ.map(o => (
                          <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                            <input
                              type="checkbox"
                              checked={o.status === 'completed'}
                              disabled={o.status === 'completed'}
                              onChange={() => onCompleteOccurrence(o.id)}
                            />
                            #{o.occurrence_index} — due {new Date(o.due_at).toLocaleDateString()}
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ),
      },
      style: {
        background: isExpanded ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.78)',
        border: n.node_type === 'cycle' ? '1.5px dashed var(--blue)' : '1px solid rgba(255,255,255,0.7)',
        borderRadius: 'var(--radius-card)',
        boxShadow: isExpanded ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
        padding: '12px 16px',
        width: isExpanded ? 272 : 220,
        transition: 'width 160ms var(--ease-out)',
      },
    }
  }), [canvasNodes, occurrencesByNode, expandedId, isBuyer, updateNode, removeNode, onCompleteOccurrence])

  const flowEdges: Edge[] = useMemo(() => canvasEdges.map(e => ({
    id: e.localId,
    source: e.fromLocalId,
    target: e.toLocalId,
    label: e.label || undefined,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--blue)', width: 20, height: 20 },
    style: { stroke: 'var(--blue)', strokeWidth: 2.5, opacity: 0.75, cursor: 'pointer' },
    interactionWidth: 24,
  })), [canvasEdges])

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges)

  useEffect(() => { setNodes(flowNodes) }, [flowNodes, setNodes])
  useEffect(() => { setEdges(flowEdges) }, [flowEdges, setEdges])

  const handleConnect = useCallback((connection: Connection) => {
    if (!isBuyer || !connection.source || !connection.target) return
    setCanvasEdges(prev => [...prev, {
      localId: `${connection.source}-${connection.target}-${Date.now()}`,
      fromLocalId: connection.source!, toLocalId: connection.target!, label: '',
    }])
  }, [isBuyer])

  const handleNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    updateNode(node.id, { position_x: node.position.x, position_y: node.position.y })
  }, [updateNode])

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setExpandedId(prev => (prev === node.id ? null : node.id))
  }, [])

  const handleEdgesDelete = useCallback((removed: Edge[]) => {
    if (!isBuyer) return
    const removedIds = new Set(removed.map(e => e.id))
    setCanvasEdges(prev => prev.filter(e => !removedIds.has(e.localId)))
  }, [isBuyer])

  const handleSave = useCallback(async () => {
    setError(null)
    const titles = canvasNodes.map(n => n.title.trim())
    if (titles.some(t => !t)) { setError('Every checkpoint needs a title'); return }
    setSaving(true)
    try {
      const byLocalId = new Map(canvasNodes.map(n => [n.localId, n.title.trim()]))
      const nodesPayload: SaveFlowNodePayload[] = canvasNodes.map(n => ({
        node_type: n.node_type,
        title: n.title.trim(),
        description: n.description || undefined,
        responsible_party: n.responsible_party,
        requires_document: n.requires_document,
        due_at: n.node_type === 'step' && n.due_at ? new Date(`${n.due_at}T23:59:59`).toISOString() : undefined,
        position_x: n.position_x,
        position_y: n.position_y,
        repeat_count: n.node_type === 'cycle' ? n.repeat_count : undefined,
        repeat_interval_days: n.node_type === 'cycle' ? n.repeat_interval_days : undefined,
        anchor_date: n.node_type === 'cycle' ? n.anchor_date : undefined,
        roadmap_stage: n.roadmapStage || undefined,
      }))
      const edgesPayload: { from: string; to: string; label?: string }[] = []
      for (const e of canvasEdges) {
        const from = byLocalId.get(e.fromLocalId)
        const to = byLocalId.get(e.toLocalId)
        if (from && to) edgesPayload.push({ from, to, label: e.label || undefined })
      }
      await onSave(nodesPayload, edgesPayload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save deal flow')
    } finally {
      setSaving(false)
    }
  }, [canvasNodes, canvasEdges, onSave])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(13,13,13,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 1320, height: '86vh', background: 'var(--white)',
        borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-elevated)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-display)' }}>Customize deal flow</div>
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>Drag to arrange, click a checkpoint to edit it. Connect checkpoints to show sequence.</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {isBuyer && <DealFlowChatPanel dealId={dealId} currentFlowSummary={currentFlowSummary} onDraftApplied={onDraftApplied} />}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {isBuyer && (
              <div style={{ display: 'flex', gap: 8, padding: '10px 22px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
                <button className="btn btn-ghost btn-sm" onClick={addStep}>+ Step</button>
                <button className="btn btn-ghost btn-sm" onClick={addCycle}>+ Shipment cycle</button>
                <button className="btn btn-ghost btn-sm" onClick={resetToDefault}>Reset to default</button>
                <div style={{ position: 'relative' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowTemplates(v => !v); setShowSaveTemplate(false) }}>
                    Templates{presets.length > 0 ? ` (${presets.length})` : ''}
                  </button>
                  {showTemplates && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 260, zIndex: 20,
                      background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                      boxShadow: 'var(--shadow-elevated)', padding: 8,
                    }}>
                      {presets.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--gray-soft)', padding: '6px 4px' }}>No saved templates yet.</div>
                      ) : presets.map(p => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px' }}>
                          <button
                            className="card-interactive"
                            disabled={templateBusy}
                            onClick={() => applyPreset(p.id)}
                            style={{ flex: 1, textAlign: 'left', border: 'none', background: 'none', fontSize: 12.5, cursor: 'pointer', padding: '2px 4px' }}
                          >
                            {p.name}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={templateBusy}
                            onClick={() => deletePreset(p.id)}
                            style={{ padding: '2px 6px', fontSize: 11, color: 'var(--color-red)' }}
                          >×</button>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
                        {showSaveTemplate ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              className="input" placeholder="Template name" value={templateName}
                              onChange={e => setTemplateName(e.target.value)} style={{ flex: 1, fontSize: 12 }}
                            />
                            <button className="btn btn-primary btn-sm" disabled={templateBusy || !templateName.trim()} onClick={saveAsTemplate}>Save</button>
                          </div>
                        ) : (
                          <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={() => setShowSaveTemplate(true)}>
                            + Save current flow as template
                          </button>
                        )}
                        {templateError && <div style={{ color: 'var(--color-red)', fontSize: 11, marginTop: 6 }}>{templateError}</div>}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }} />
                {error && <span style={{ color: 'var(--color-red)', fontSize: 12, alignSelf: 'center' }}>{error}</span>}
                <button className="btn btn-primary btn-sm" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            )}

            <div style={{ flex: 1, position: 'relative' }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                onNodeDragStop={handleNodeDragStop}
                onNodeClick={handleNodeClick}
                onEdgesDelete={isBuyer ? handleEdgesDelete : undefined}
                nodesDraggable={isBuyer}
                nodesConnectable={isBuyer}
                elementsSelectable
                deleteKeyCode={isBuyer ? ['Backspace', 'Delete'] : []}
                fitView
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--border)" />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
