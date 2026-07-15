import { adminClient } from '../admin'

export interface GetAgentTasksInput {
  org_id: string
  status?: 'awaiting_approval' | 'completed' | 'failed' | 'rejected' | 'all'
  limit?: number
}

export async function getAgentTasks(input: GetAgentTasksInput): Promise<Record<string, unknown>> {
  const { org_id, status = 'all', limit = 20 } = input

  let query = adminClient
    .from('agent_tasks')
    .select('id, type, title, body, status, proposed_action, result, created_at, approved_at, rejected_reason')
    .eq('org_id', org_id)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50))

  if (status !== 'all') query = query.eq('status', status)

  const { data: tasks, error } = await query
  if (error) return { error: error.message }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taskList: any[] = tasks ?? []
  const pending   = taskList.filter((t) => t.status === 'awaiting_approval').length
  const completed = taskList.filter((t) => t.status === 'completed').length
  const failed    = taskList.filter((t) => t.status === 'failed').length
  const rejected  = taskList.filter((t) => t.status === 'rejected').length

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tasks: taskList.map((t: any) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      body: t.body,
      status: t.status,
      tool: t.proposed_action?.tool_name ?? null,
      created_at: t.created_at,
      approved_at: t.approved_at,
      rejected_reason: t.rejected_reason,
    })),
    summary: { pending, completed, failed, rejected, total: (tasks ?? []).length },
  }
}
