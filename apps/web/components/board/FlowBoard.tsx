'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState, BackgroundVariant, Position,
  type Node, type Edge, type Connection, type NodeMouseHandler, type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { BoardColumn, BoardEdge, BoardTask } from './types'

const COLUMN_WIDTH_GAP = 280
// Same restrained palette as KanbanBoard — column identity stays consistent
// between the two views.
const COLUMN_PALETTE = ['#5B6EE8', '#9B7EE8', '#4FAE8E', '#D99A4E']
const PRIORITY_COLOR: Record<string, string> = {
  low: 'var(--gray-soft)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
}
const PREVIEW_COUNT = 3
const COLLAPSED_WIDTH = 216
const EXPANDED_WIDTH = 268

function initials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

function TaskRow({ task, onOpenTask }: { task: BoardTask; onOpenTask: (id: string) => void }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onOpenTask(task.id) }}
      className="card-interactive"
      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', borderRadius: 7, cursor: 'pointer' }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: PRIORITY_COLOR[task.priority], flexShrink: 0 }} />
      <span style={{
        fontSize: 11.5, color: 'var(--ink-soft)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {task.title}
      </span>
      {task.assignee && (
        <span
          title={task.assignee.full_name}
          style={{
            width: 17, height: 17, borderRadius: '50%', background: 'var(--blue-light)',
            color: 'var(--blue)', fontSize: 8, fontWeight: 700, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {initials(task.assignee.full_name)}
        </span>
      )}
    </div>
  )
}

function toFlowNode(
  column: BoardColumn, columnTasks: BoardTask[], index: number, isExpanded: boolean, onOpenTask: (id: string) => void
): Node {
  const accent = column.color || COLUMN_PALETTE[index % COLUMN_PALETTE.length]!
  const preview = columnTasks.slice(0, PREVIEW_COUNT)
  const remaining = columnTasks.length - preview.length
  const assignees = Array.from(
    new Map(columnTasks.filter(t => t.assignee).map(t => [t.assignee!.id, t.assignee!])).values()
  ).slice(0, 4)

  return {
    id: column.id,
    position: {
      x: column.position_x ?? index * COLUMN_WIDTH_GAP,
      y: column.position_y ?? 100,
    },
    // Columns lay out left-to-right, so connections should enter/leave from
    // the sides, not the top/bottom — reads as a proper flow diagram.
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    zIndex: isExpanded ? 1000 : 0,
    data: {
      label: (
        <div style={{ width: '100%', textAlign: 'left' }}>
          <div style={{ height: 4, background: accent, borderRadius: '3px 3px 0 0', margin: '-14px -18px 11px' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: (isExpanded ? columnTasks.length : preview.length) ? 9 : 2 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>{column.name}</span>
            <span style={{
              fontSize: 10.5, fontWeight: 700, color: accent, background: `${accent}1C`,
              borderRadius: 'var(--radius-badge)', padding: '1.5px 8px', flexShrink: 0,
            }}>
              {columnTasks.length}
            </span>
          </div>

          {isExpanded ? (
            columnTasks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflowY: 'auto' }}>
                {columnTasks.map(task => (
                  <TaskRow key={task.id} task={task} onOpenTask={onOpenTask} />
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: 'var(--gray-soft)', padding: '4px 6px' }}>No tasks in this stage</div>
            )
          ) : (
            <>
              {preview.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: assignees.length ? 10 : 2 }}>
                  {preview.map(task => (
                    <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: PRIORITY_COLOR[task.priority], flexShrink: 0 }} />
                      <span style={{
                        fontSize: 11, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden',
                        textOverflow: 'ellipsis', maxWidth: 168,
                      }}>
                        {task.title}
                      </span>
                    </div>
                  ))}
                  {remaining > 0 && (
                    <div style={{ fontSize: 10.5, color: 'var(--gray-soft)', fontWeight: 600 }}>+{remaining} more</div>
                  )}
                </div>
              )}

              {assignees.length > 0 && (
                <div style={{ display: 'flex' }}>
                  {assignees.map((a, i) => (
                    <span
                      key={a.id}
                      title={a.full_name}
                      style={{
                        width: 19, height: 19, borderRadius: '50%', background: 'var(--blue-light)',
                        color: 'var(--blue)', fontSize: 8.5, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1.5px solid var(--white)', marginLeft: i === 0 ? 0 : -6,
                      }}
                    >
                      {initials(a.full_name)}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ),
    },
    style: {
      background: isExpanded ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.72)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      border: isExpanded ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.7)',
      borderRadius: 'var(--radius-card)',
      boxShadow: isExpanded ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
      padding: '14px 18px 13px',
      width: isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
      transition: 'width 180ms var(--ease-out), background 180ms var(--ease-out)',
    },
  }
}

function toFlowEdge(edge: BoardEdge): Edge {
  return {
    id: edge.id,
    source: edge.from_column_id,
    target: edge.to_column_id,
    sourceHandle: null,
    targetHandle: null,
    label: edge.label ?? undefined,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--blue)', width: 16, height: 16 },
    style: { stroke: 'var(--blue)', strokeWidth: 1.5, opacity: 0.5 },
    labelStyle: { fontSize: 11, fontWeight: 600, fill: 'var(--gray)' },
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
  // Clicking a node expands it in place to show its full task list — no
  // separate floating popover competing for attention.
  const [expandedColumnId, setExpandedColumnId] = useState<string | null>(null)

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, BoardTask[]>()
    for (const column of columns) map.set(column.id, [])
    for (const task of tasks) map.get(task.column_id)?.push(task)
    return map
  }, [columns, tasks])

  const initialNodes = useMemo(
    () => columns.map((c, i) => toFlowNode(c, tasksByColumn.get(c.id) ?? [], i, false, onOpenTask)),
    [] // eslint-disable-line react-hooks/exhaustive-deps -- seed once; the effect below keeps nodes in sync afterward
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const initialEdges = useMemo(() => edges.map(toFlowEdge), [edges])
  const [flowEdges, , onEdgesChange] = useEdgesState(initialEdges)

  // Rebuild node data/style whenever the underlying data or expansion state
  // changes, but keep each node's live `position` (drag results) rather
  // than snapping back to the column's stored position on every update.
  useEffect(() => {
    setNodes(prev => columns.map((c, i) => {
      const built = toFlowNode(c, tasksByColumn.get(c.id) ?? [], i, expandedColumnId === c.id, onOpenTask)
      const existing = prev.find(n => n.id === c.id)
      return existing ? { ...built, position: existing.position } : built
    }))
  }, [columns, tasksByColumn, expandedColumnId, onOpenTask, setNodes])

  const handleConnect = useCallback((connection: Connection) => {
    if (!isAdmin || !connection.source || !connection.target) return
    onCreateEdge(connection.source, connection.target)
  }, [isAdmin, onCreateEdge])

  const handleNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    if (!isAdmin) return
    onMoveColumn(node.id, node.position.x, node.position.y)
  }, [isAdmin, onMoveColumn])

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setExpandedColumnId(prev => (prev === node.id ? null : node.id))
  }, [])

  return (
    <div className="board-glass" style={{
      position: 'relative', zIndex: 1, height: 480, borderRadius: 'var(--radius-card)', overflow: 'hidden',
      boxShadow: 'var(--shadow-elevated)',
    }}>
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
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
