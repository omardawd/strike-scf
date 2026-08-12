'use client'

import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCorners, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '@/lib/i18n/locale-context'
import type { BoardColumn, BoardTask } from './types'

const PRIORITY_COLOR: Record<string, string> = {
  low: 'var(--gray)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
}

function TaskCard({ task, draggable }: { task: BoardTask; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: 'var(--white)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        padding: '10px 12px',
        marginBottom: 8,
        cursor: draggable ? 'grab' : 'default',
        boxShadow: 'var(--shadow-card)',
      }}
      {...(draggable ? { ...attributes, ...listeners } : {})}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{task.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 600, color: PRIORITY_COLOR[task.priority],
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {task.priority}
        </span>
        {task.assignee && (
          <span
            title={task.assignee.full_name}
            style={{
              width: 20, height: 20, borderRadius: '50%', background: 'var(--blue-light)',
              color: 'var(--blue)', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            {task.assignee.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      {task.due_date && (
        <div style={{ fontSize: 11, color: 'var(--gray-soft)', marginTop: 6 }}>
          {new Date(task.due_date).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}

function ColumnDropZone({
  column, tasks, isAdmin, currentUserId, onDeleteColumn,
}: {
  column: BoardColumn
  tasks: BoardTask[]
  isAdmin: boolean
  currentUserId: string | undefined
  onDeleteColumn: (id: string) => void
}) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const taskIds = tasks.map(tk => tk.id)

  return (
    <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{column.name}</span>
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--gray)', background: 'var(--offwhite)',
            borderRadius: 'var(--radius-badge)', padding: '1px 8px',
          }}>
            {tasks.length}
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={() => onDeleteColumn(column.id)}
            title="Delete stage"
            style={{ border: 'none', background: 'none', color: 'var(--gray-soft)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        style={{
          background: isOver ? 'var(--blue-light)' : 'var(--offwhite)',
          borderRadius: 'var(--radius-card)',
          padding: 10,
          minHeight: 120,
          flex: 1,
          transition: 'background var(--dur-1) var(--ease-out)',
        }}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--gray-soft)', textAlign: 'center', padding: '16px 0' }}>
              {t('board.noTasks')}
            </div>
          )}
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              draggable={isAdmin || task.assignee_user_id === currentUserId}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}

export function KanbanBoard({
  columns, tasks, isAdmin, currentUserId, onMoveTask, onDeleteColumn,
}: {
  columns: BoardColumn[]
  tasks: BoardTask[]
  isAdmin: boolean
  currentUserId: string | undefined
  onMoveTask: (taskId: string, columnId: string) => void
  onDeleteColumn: (columnId: string) => void
}) {
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, BoardTask[]>()
    for (const column of columns) map.set(column.id, [])
    for (const task of tasks) map.get(task.column_id)?.push(task)
    return map
  }, [columns, tasks])

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find(tk => tk.id === event.active.id)
    setActiveTask(task ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const { active, over } = event
    if (!over) return
    const draggedTask = tasks.find(tk => tk.id === active.id)
    if (!draggedTask) return
    // `over.id` is either a column's droppable id (dropped on empty space)
    // or another task's id (dropped on/near a card) — resolve to that
    // card's column either way.
    const overColumnId = columns.some(c => c.id === over.id)
      ? (over.id as string)
      : tasks.find(tk => tk.id === over.id)?.column_id
    if (overColumnId && overColumnId !== draggedTask.column_id) {
      onMoveTask(draggedTask.id, overColumnId)
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
        {columns.map(column => (
          <ColumnDropZone
            key={column.id}
            column={column}
            tasks={tasksByColumn.get(column.id) ?? []}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onDeleteColumn={onDeleteColumn}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} draggable />}
      </DragOverlay>
    </DndContext>
  )
}
