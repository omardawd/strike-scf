export interface BoardRow {
  id: string
  org_id: string | null
  bank_id: string | null
  name: string
}

export interface BoardColumn {
  id: string
  board_id: string
  name: string
  position: number
  color: string | null
  position_x: number | null
  position_y: number | null
}

export interface BoardEdge {
  id: string
  board_id: string
  from_column_id: string
  to_column_id: string
  label: string | null
}

export interface BoardTask {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string | null
  assignee_user_id: string | null
  assignee: { id: string; full_name: string; email: string } | null
  priority: 'low' | 'medium' | 'high'
  due_date: string | null
  labels: string[]
  position: number
  checklist_done: number
  checklist_total: number
  comment_count: number
}

export interface BoardData {
  board: BoardRow
  columns: BoardColumn[]
  edges: BoardEdge[]
  tasks: BoardTask[]
  is_admin: boolean
}

export interface ChecklistItem {
  id: string
  task_id: string
  text: string
  is_done: boolean
  position: number
}

export interface TaskComment {
  id: string
  task_id: string
  kind: 'comment' | 'activity'
  author_user_id: string | null
  author: { id: string; full_name: string; email: string } | null
  body: string
  created_at: string
}

export interface TaskDetail {
  task: BoardTask
  checklist_items: ChecklistItem[]
  comments: TaskComment[]
  is_admin: boolean
  current_user_id: string
}
