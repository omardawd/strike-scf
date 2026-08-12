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

// Column accent palette — cycles by position so every stage reads as a
// distinct lane at a glance, same "give each thing its own identity" idea
// as the label-chip hashing below.
const COLUMN_PALETTE = ['#1428CC', '#7C3AED', '#10B981', '#F59E0B', '#0891B2', '#EF4444']
const LABEL_PALETTE = ['#1428CC', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#0891B2']

function labelColor(label: string): string {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return LABEL_PALETTE[hash % LABEL_PALETTE.length]!
}

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate).getTime() < new Date().setHours(0, 0, 0, 0)
}

function TaskCard({ task, draggable, onOpen }: { task: BoardTask; draggable: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const overdue = task.due_date && task.priority !== 'low' && isOverdue(task.due_date)

  return (
    <div
      ref={setNodeRef}
      className="card-interactive"
      onClick={onOpen}
      style={{
        ...style,
        background: 'var(--white)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${PRIORITY_COLOR[task.priority]}`,
        padding: '11px 13px',
        marginBottom: 9,
        cursor: draggable ? 'grab' : 'pointer',
        boxShadow: 'var(--shadow-card)',
      }}
      {...(draggable ? { ...attributes, ...listeners } : {})}
    >
      {task.labels.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {task.labels.slice(0, 3).map(label => (
            <span key={label} style={{
              fontSize: 9.5, fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--radius-badge)',
              background: `${labelColor(label)}1A`, color: labelColor(label),
            }}>
              {label}
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 8, lineHeight: 1.35 }}>{task.title}</div>

      {task.checklist_total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <div style={{ flex: 1, height: 3, background: 'var(--offwhite)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${(task.checklist_done / task.checklist_total) * 100}%`,
              background: task.checklist_done === task.checklist_total ? 'var(--color-green)' : 'var(--blue)',
            }} />
          </div>
          <span style={{ fontSize: 10.5, color: 'var(--gray-soft)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {task.checklist_done}/{task.checklist_total}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: PRIORITY_COLOR[task.priority],
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {task.priority}
          </span>
          {task.due_date && (
            <span style={{ fontSize: 11, color: overdue ? 'var(--color-red)' : 'var(--gray-soft)', fontWeight: overdue ? 700 : 400 }}>
              {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          {task.comment_count > 0 && (
            <span style={{ fontSize: 11, color: 'var(--gray-soft)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              💬 {task.comment_count}
            </span>
          )}
        </div>
        {task.assignee && (
          <span
            title={task.assignee.full_name}
            style={{
              width: 21, height: 21, borderRadius: '50%', background: 'var(--blue-light)',
              color: 'var(--blue)', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            {task.assignee.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
    </div>
  )
}

function ColumnDropZone({
  column, accent, tasks, isAdmin, currentUserId, onDeleteColumn, onOpenTask,
}: {
  column: BoardColumn
  accent: string
  tasks: BoardTask[]
  isAdmin: boolean
  currentUserId: string | undefined
  onDeleteColumn: (id: string) => void
  onOpenTask: (id: string) => void
}) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const taskIds = tasks.map(tk => tk.id)

  return (
    <div style={{ width: 272, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{column.name}</span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: accent, background: `${accent}14`,
            borderRadius: 'var(--radius-badge)', padding: '1px 9px',
          }}>
            {tasks.length}
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={() => onDeleteColumn(column.id)}
            title="Delete stage"
            style={{ border: 'none', background: 'none', color: 'var(--gray-soft)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        style={{
          background: isOver ? 'var(--blue-light)' : 'var(--offwhite)',
          border: `1px solid ${isOver ? accent : 'transparent'}`,
          borderRadius: 'var(--radius-card)',
          padding: 11,
          minHeight: 140,
          flex: 1,
          transition: 'background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out)',
        }}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--gray-soft)', textAlign: 'center', padding: '20px 0' }}>
              {t('board.noTasks')}
            </div>
          )}
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              draggable={isAdmin || task.assignee_user_id === currentUserId}
              onOpen={() => onOpenTask(task.id)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}

export function KanbanBoard({
  columns, tasks, isAdmin, currentUserId, onMoveTask, onDeleteColumn, onOpenTask,
}: {
  columns: BoardColumn[]
  tasks: BoardTask[]
  isAdmin: boolean
  currentUserId: string | undefined
  onMoveTask: (taskId: string, columnId: string) => void
  onDeleteColumn: (columnId: string) => void
  onOpenTask: (taskId: string) => void
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
      <div style={{
        display: 'flex', gap: 20, overflowX: 'auto', padding: '18px 20px 22px',
        background: 'var(--white)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)',
      }}>
        {columns.map((column, i) => (
          <ColumnDropZone
            key={column.id}
            column={column}
            accent={column.color || COLUMN_PALETTE[i % COLUMN_PALETTE.length]!}
            tasks={tasksByColumn.get(column.id) ?? []}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onDeleteColumn={onDeleteColumn}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} draggable onOpen={() => {}} />}
      </DragOverlay>
    </DndContext>
  )
}
