'use client'

import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCorners, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '@/lib/i18n/locale-context'
import type { BoardColumn, BoardTask } from './types'

const PRIORITY_COLOR: Record<string, string> = {
  low: 'var(--gray-soft)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
}

// A restrained, desaturated set — column identity should read at a glance
// without turning the board into a rainbow. Muted rather than saturated so
// it stays calm next to the app's mostly-blue-and-neutral palette.
const COLUMN_PALETTE = ['#5B6EE8', '#9B7EE8', '#4FAE8E', '#D99A4E']
const LABEL_PALETTE = ['#1428CC', '#7C3AED', '#10B981', '#B45309']

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
      className="board-card"
      onClick={onOpen}
      style={{
        ...style,
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        padding: '13px 14px',
        marginBottom: 8,
        cursor: draggable ? 'grab' : 'pointer',
        boxShadow: 'var(--shadow-card)',
      }}
      {...(draggable ? { ...attributes, ...listeners } : {})}
    >
      {task.labels.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 7 }}>
          {task.labels.slice(0, 3).map(label => (
            <span key={label} style={{
              fontSize: 9.5, fontWeight: 600, padding: '1px 7px', borderRadius: 'var(--radius-badge)',
              background: `${labelColor(label)}14`, color: labelColor(label),
            }}>
              {label}
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 9, lineHeight: 1.4 }}>{task.title}</div>

      {task.checklist_total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
          <div style={{ flex: 1, height: 3, background: 'var(--offwhite)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${(task.checklist_done / task.checklist_total) * 100}%`,
              background: task.checklist_done === task.checklist_total ? 'var(--color-green)' : 'var(--blue)',
              transition: 'width var(--dur-2) var(--ease-out)',
            }} />
          </div>
          <span style={{ fontSize: 10.5, color: 'var(--gray-soft)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {task.checklist_done}/{task.checklist_total}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLOR[task.priority], flexShrink: 0 }} />
          {task.due_date && (
            <span style={{ fontSize: 11.5, color: overdue ? 'var(--color-red)' : 'var(--gray-soft)', fontWeight: overdue ? 600 : 400 }}>
              {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          {task.comment_count > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--gray-soft)' }}>
              {task.comment_count} comment{task.comment_count === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {task.assignee && (
          <span
            title={task.assignee.full_name}
            style={{
              width: 20, height: 20, borderRadius: '50%', background: 'var(--blue-light)',
              color: 'var(--blue)', fontSize: 9.5, fontWeight: 700,
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

  const {
    attributes, listeners, setNodeRef: setColumnNodeRef, transform: columnTransform,
    transition: columnTransition, isDragging: isColumnDragging,
  } = useSortable({ id: column.id, disabled: !isAdmin })
  const columnStyle = {
    transform: CSS.Transform.toString(columnTransform),
    transition: columnTransition,
    opacity: isColumnDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setColumnNodeRef}
      className="board-col"
      style={{ ...columnStyle, flex: '1 1 0', minWidth: 260, maxWidth: 360, display: 'flex', flexDirection: 'column' }}
    >
      <div
        {...(isAdmin ? { ...attributes, ...listeners } : {})}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 2px',
          cursor: isAdmin ? 'grab' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--ink)', letterSpacing: '-0.01em' }}>{column.name}</span>
          <span style={{
            fontSize: 11.5, fontWeight: 700, color: accent, background: `${accent}1C`,
            borderRadius: 'var(--radius-badge)', padding: '1.5px 8px',
          }}>
            {tasks.length}
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteColumn(column.id) }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Delete stage"
            className="board-col-actions"
            style={{ border: 'none', background: 'none', color: 'var(--gray-soft)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        style={{
          background: isOver ? 'rgba(20,40,204,0.10)' : 'rgba(255,255,255,0.28)',
          border: `1px solid ${isOver ? 'rgba(20,40,204,0.25)' : 'rgba(255,255,255,0.4)'}`,
          borderRadius: 'var(--radius-card)',
          padding: 10,
          minHeight: 140,
          flex: 1,
          transition: 'background var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out)',
        }}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--gray-soft)', textAlign: 'center', padding: '24px 0' }}>
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
  columns, tasks, isAdmin, currentUserId, onMoveTask, onDeleteColumn, onOpenTask, onReorderColumns,
}: {
  columns: BoardColumn[]
  tasks: BoardTask[]
  isAdmin: boolean
  currentUserId: string | undefined
  onMoveTask: (taskId: string, columnId: string) => void
  onDeleteColumn: (columnId: string) => void
  onOpenTask: (taskId: string) => void
  onReorderColumns: (newOrder: BoardColumn[]) => void
}) {
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null)
  const [activeColumn, setActiveColumn] = useState<BoardColumn | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const columnIds = useMemo(() => columns.map(c => c.id), [columns])

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, BoardTask[]>()
    for (const column of columns) map.set(column.id, [])
    for (const task of tasks) map.get(task.column_id)?.push(task)
    return map
  }, [columns, tasks])

  function handleDragStart(event: DragStartEvent) {
    const column = columns.find(c => c.id === event.active.id)
    if (column) { setActiveColumn(column); return }
    const task = tasks.find(tk => tk.id === event.active.id)
    setActiveTask(task ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (activeColumn) {
      setActiveColumn(null)
      if (!over || active.id === over.id) return
      // Only reorder when dropped near another column's header — dropping
      // on a task inside some other column is a no-op rather than a
      // surprising reorder.
      if (!columns.some(c => c.id === over.id)) return
      const oldIndex = columns.findIndex(c => c.id === active.id)
      const newIndex = columns.findIndex(c => c.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      onReorderColumns(arrayMove(columns, oldIndex, newIndex))
      return
    }

    setActiveTask(null)
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
      <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
        <div className="board-glass" style={{
          position: 'relative', zIndex: 1, flex: 1, minHeight: 520,
          display: 'flex', gap: 22, overflowX: 'auto', padding: '20px 22px 24px',
          borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-elevated)',
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
      </SortableContext>
      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} draggable onOpen={() => {}} />}
        {activeColumn && (
          <div className="board-glass" style={{ width: 260, padding: '10px 16px', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-elevated)', fontSize: 13.5, fontWeight: 600, fontFamily: 'var(--font-display)' }}>
            {activeColumn.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
