'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState, BackgroundVariant,
  type Node, type Edge, type Connection, type NodeMouseHandler, type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { BoardColumn, BoardEdge, BoardTask } from './types'

const COLUMN_WIDTH_GAP = 240
const COLUMN_PALETTE = ['#1428CC', '#7C3AED', '#10B981', '#F59E0B', '#0891B2', '#EF4444']

function toFlowNode(column: BoardColumn, taskCount: number, index: number): Node {
  const accent = column.color || COLUMN_PALETTE[index % COLUMN_PALETTE.length]!
  return {
    id: column.id,
    position: {
      x: column.position_x ?? index * COLUMN_WIDTH_GAP,
      y: column.position_y ?? 100,
    },
    data: {
      label: (
        <div style={{ textAlign: 'center', width: '100%' }}>
          <div style={{ height: 4, background: accent, borderRadius: '3px 3px 0 0', margin: '-13px -17px 10px' }} />
          <div style={{ fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--font-display)' }}>{column.name}</div>
          <div style={{
            display: 'inline-block', fontSize: 11, fontWeight: 700, color: accent, background: `${accent}14`,
            borderRadius: 'var(--radius-badge)', padding: '1px 10px', marginTop: 6,
          }}>
            {taskCount} task{taskCount === 1 ? '' : 's'}
          </div>
        </div>
      ),
    },
    style: {
      background: 'var(--white)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)',
      boxShadow: 'var(--shadow-card)',
      padding: '13px 17px',
      width: 172,
    },
  }
}

function toFlowEdge(edge: BoardEdge): Edge {
  return {
    id: edge.id,
    source: edge.from_column_id,
    target: edge.to_column_id,
    label: edge.label ?? undefined,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--blue)' },
    style: { stroke: 'var(--blue)', strokeWidth: 1.75, opacity: 0.55 },
    labelStyle: { fontSize: 11, fontWeight: 600, fill: 'var(--ink)' },
    labelBgStyle: { fill: 'var(--white)' },
  }
}

export function FlowBoard({
  columns, edges, tasks, isAdmin,
  onMoveColumn, onCreateEdge, onDeleteEdge, onOpenTask,
}: {
  columns: BoardColumn[]
  edges: BoardEdge[]
  tasks: BoardTask[]
  isAdmin: boolean
  onMoveColumn: (columnId: string, x: number, y: number) => void
  onCreateEdge: (fromColumnId: string, toColumnId: string) => void
  onDeleteEdge: (edgeId: string) => void
  onOpenTask: (taskId: string) => void
}) {
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null)

  const taskCountByColumn = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of tasks) map.set(task.column_id, (map.get(task.column_id) ?? 0) + 1)
    return map
  }, [tasks])

  const initialNodes = useMemo(
    () => columns.map((c, i) => toFlowNode(c, taskCountByColumn.get(c.id) ?? 0, i)),
    [columns, taskCountByColumn]
  )
  const initialEdges = useMemo(() => edges.map(toFlowEdge), [edges])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [flowEdges, , onEdgesChange] = useEdgesState(initialEdges)

  const handleConnect = useCallback((connection: Connection) => {
    if (!isAdmin || !connection.source || !connection.target) return
    onCreateEdge(connection.source, connection.target)
  }, [isAdmin, onCreateEdge])

  const handleNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    if (!isAdmin) return
    onMoveColumn(node.id, node.position.x, node.position.y)
  }, [isAdmin, onMoveColumn])

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedColumnId(prev => (prev === node.id ? null : node.id))
  }, [])

  const selectedColumn = columns.find(c => c.id === selectedColumnId)
  const selectedTasks = selectedColumnId ? tasks.filter(t => t.column_id === selectedColumnId) : []
  const selectedAccent = selectedColumn
    ? selectedColumn.color || COLUMN_PALETTE[columns.findIndex(c => c.id === selectedColumn.id) % COLUMN_PALETTE.length]!
    : 'var(--blue)'

  return (
    <div style={{
      position: 'relative', borderRadius: 'var(--radius-card)', overflow: 'hidden',
      boxShadow: 'var(--shadow-card)', background: 'var(--white)',
    }}>
      <div style={{ height: 4, background: 'var(--gradient-ai)' }} />
      <div style={{ position: 'relative', height: 476 }}>
        <ReactFlow
          nodes={nodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={handleNodeClick}
          onEdgesDelete={isAdmin ? (removed => removed.forEach(e => onDeleteEdge(e.id))) : undefined}
          nodesDraggable={isAdmin}
          nodesConnectable={isAdmin}
          elementsSelectable
          deleteKeyCode={isAdmin ? ['Backspace', 'Delete'] : []}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--border-strong)" />
          <Controls showInteractive={false} />
        </ReactFlow>

        {selectedColumn && (
          <div style={{
            position: 'absolute', top: 16, right: 16, width: 250,
            background: 'var(--white)', borderRadius: 'var(--radius-card)',
            border: '1px solid var(--border)', boxShadow: 'var(--shadow-elevated)',
            padding: 14, zIndex: 10, maxHeight: 400, overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: selectedAccent }} />
                {selectedColumn.name}
              </span>
              <button onClick={() => setSelectedColumnId(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gray-soft)' }}>✕</button>
            </div>
            {selectedTasks.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--gray-soft)' }}>No tasks in this stage</div>
            ) : (
              selectedTasks.map(task => (
                <div
                  key={task.id}
                  onClick={() => onOpenTask(task.id)}
                  className="card-interactive"
                  style={{ padding: '7px 8px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
                >
                  <div style={{ fontWeight: 600 }}>{task.title}</div>
                  {task.assignee && <div style={{ color: 'var(--gray)', fontSize: 11 }}>{task.assignee.full_name}</div>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
