import { describe, expect, it, vi } from 'vitest'

const insertMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ insert: insertMock }),
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/error-tracking', () => ({
  captureException: vi.fn(),
}))

describe('writeAuditEvent', () => {
  it('inserts a row with the expected shape', async () => {
    insertMock.mockResolvedValueOnce({ error: null })
    const { writeAuditEvent } = await import('./log')

    await writeAuditEvent({
      actorUserId: 'user-1',
      actorRole: 'org_admin',
      tenantOrgId: 'org-1',
      action: 'user.is_active_changed',
      targetType: 'user',
      targetId: 'user-2',
      beforeData: { is_active: true },
      afterData: { is_active: false },
    })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'user-1',
        action: 'user.is_active_changed',
        target_type: 'user',
        target_id: 'user-2',
        source: 'api',
        outcome: 'success',
        before_data: { is_active: true },
        after_data: { is_active: false },
      })
    )
  })

  it('logs an error (does not throw) when the insert fails', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'db unavailable' } })
    const { writeAuditEvent } = await import('./log')
    const { logger } = await import('@/lib/logger')
    const { captureException } = await import('@/lib/error-tracking')

    await expect(
      writeAuditEvent({ actorUserId: 'user-1', action: 'test.action', targetType: 'test' })
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalled()
    expect(captureException).toHaveBeenCalled()
  })
})
