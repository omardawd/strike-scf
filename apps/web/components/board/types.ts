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
  auto_assign_agent_id: string | null
  requires_review: boolean
}

export interface BoardEdge {
  id: string
  board_id: string
  from_column_id: string
  to_column_id: string
  label: string | null
}

export interface BoardAgent {
  id: string
  org_id: string | null
  bank_id: string | null
  name: string
  role_label: string | null
  persona: string | null
  task_types: string[]
  expected_output: string | null
  guardrails: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface BoardTask {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string | null
  assignee_user_id: string | null
  assignee: { id: string; full_name: string; email: string } | null
  assignee_agent_id: string | null
  assignee_agent: { id: string; name: string; role_label: string | null } | null
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
  agents: BoardAgent[]
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

export interface AgentFindings {
  summary: string
  key_findings: string[]
  recommendations: string[]
  caveats: string[]
  suggested_next_step: string
}

export interface BoardTaskAgentRun {
  id: string
  task_id: string
  agent_id: string
  agent: { id: string; name: string; role_label: string | null } | null
  status: 'completed' | 'failed'
  output: AgentFindings | null
  error: string | null
  model: string | null
  created_at: string
}

export interface TaskDetail {
  task: BoardTask
  checklist_items: ChecklistItem[]
  comments: TaskComment[]
  agent_runs: BoardTaskAgentRun[]
  is_admin: boolean
  current_user_id: string
}
