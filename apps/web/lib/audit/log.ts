import { createClient as createAdmin } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { captureException } from '@/lib/error-tracking'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface AuditEvent {
  actorUserId: string | null
  actorRole?: string | null
  tenantOrgId?: string | null
  tenantBankId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  requestId?: string | null
  source?: 'api' | 'cron' | 'ai_tool' | 'dispatch'
  outcome?: 'success' | 'failure'
  // Caller's responsibility: never pass document bodies, full bank account/
  // routing numbers, secrets, or raw AI prompts here. Keep to IDs, statuses,
  // and other non-sensitive fields — see docs/security/AI_GOVERNANCE.md.
  beforeData?: Record<string, unknown> | null
  afterData?: Record<string, unknown> | null
}

/**
 * Writes one row to the append-only audit_events table (see migration
 * 00000000000045). Never throws — a failed audit write must not break the
 * request it's instrumenting — but it also must never fail silently
 * (Track J requirement: "audit writes cannot silently disappear"), so a
 * failure is logged at error level and reported to error-tracking.
 */
export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  const { error } = await adminClient.from('audit_events').insert({
    actor_user_id: event.actorUserId,
    actor_role: event.actorRole ?? null,
    tenant_org_id: event.tenantOrgId ?? null,
    tenant_bank_id: event.tenantBankId ?? null,
    action: event.action,
    target_type: event.targetType,
    target_id: event.targetId ?? null,
    request_id: event.requestId ?? null,
    source: event.source ?? 'api',
    outcome: event.outcome ?? 'success',
    before_data: event.beforeData ?? null,
    after_data: event.afterData ?? null,
  })

  if (error) {
    const failure = new Error(`audit_events insert failed: ${error.message}`)
    logger.error(failure.message, { action: event.action, targetType: event.targetType, targetId: event.targetId })
    captureException(failure, { action: event.action, targetType: event.targetType })
  }
}
