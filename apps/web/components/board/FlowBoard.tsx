'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState,
  type Node, type Edge, type Connection, type NodeMouseHandler, type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { BoardColumn, BoardEdge, BoardTask } from './types'

const COLUMN_WIDTH_GAP = 220

function toFlowNode(column: BoardColumn, taskCount: number, index: number): Node {
  return {
    id: column.id,
    position: {
      x: column.position_x ?? index * COLUMN_WIDTH_GAP,
      y: column.position_y ?? 80,
    },
    data: {
      label: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{column.name}</div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
            {taskCount} task{taskCount === 1 ? '' : 's'}
          </div>
        </div>
      ),
    },
    style: {
      background: 'var(--white)',
      border: '1.5px solid var(--border-strong)',
      borderRadius: 'var(--radius-card)',
      padding: 10,
      width: 150,
    },
  }
}

function toFlowEdge(edge: BoardEdge): Edge {
  return {
    id: edge.id,
    source: edge.from_column_id,
    target: edge.to_column_id,
    label: edge.label ?? undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'var(--gray-soft)' },
  }
}

export function FlowBoard({
  columns, edges, tasks, isAdmin,
  onMoveColumn, onCreateEdge, onDeleteEdge,
}: {
  columns: BoardColumn[]
  edges: BoardEdge[]
  tasks: BoardTask[]
  isAdmin: boolean
  onMoveColumn: (columnId: string, x: number, y: number) => void
  onCreateEdge: (fromColumnId: string, toColumnId: string) => void
  onDeleteEdge: (edgeId: string) => void
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

  return (
    <div style={{ position: 'relative', height: 480, borderRadius: 'var(--radius-card)', overflow: 'hidden', border: '1px solid var(--border)' }}>
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
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>

      {selectedColumn && (
        <div style={{
          position: 'absolute', top: 16, right: 16, width: 240,
          background: 'var(--white)', borderRadius: 'var(--radius-card)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-elevated)',
          padding: 14, zIndex: 10, maxHeight: 400, overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{selectedColumn.name}</span>
            <button onClick={() => setSelectedColumnId(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gray-soft)' }}>✕</button>
          </div>
          {selectedTasks.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--gray-soft)' }}>No tasks in this stage</div>
          ) : (
            selectedTasks.map(task => (
              <div key={task.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                <div style={{ fontWeight: 600 }}>{task.title}</div>
                {task.assignee && <div style={{ color: 'var(--gray)', fontSize: 11 }}>{task.assignee.full_name}</div>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
