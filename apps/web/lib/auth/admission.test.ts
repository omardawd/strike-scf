import { describe, expect, it } from 'vitest'
import { isOrgAdmitted } from './admission'

describe('isOrgAdmitted', () => {
  it('admits an org that is active and approved', () => {
    expect(isOrgAdmitted({ status: 'active', kyb_status: 'approved' })).toBe(true)
  })

  it('rejects null/undefined orgs', () => {
    expect(isOrgAdmitted(null)).toBe(false)
    expect(isOrgAdmitted(undefined)).toBe(false)
  })

  const nonAdmittedKybStatuses = [
    'not_started',
    'in_progress',
    'submitted',
    'ai_reviewing',
    'under_review',
    'rejected',
    'more_info_requested',
  ]

  for (const kyb_status of nonAdmittedKybStatuses) {
    it(`rejects kyb_status='${kyb_status}' even if org status is active`, () => {
      expect(isOrgAdmitted({ status: 'active', kyb_status })).toBe(false)
    })
  }

  const nonActiveOrgStatuses = [
    'pending_kyb',
    'kyb_in_progress',
    'kyb_submitted',
    'kyb_ai_reviewing',
    'suspended',
    'rejected',
  ]

  for (const status of nonActiveOrgStatuses) {
    it(`rejects org status='${status}' even if kyb_status is approved`, () => {
      expect(isOrgAdmitted({ status, kyb_status: 'approved' })).toBe(false)
    })
  }

  it('rejects a suspended org even if kyb_status is still approved', () => {
    expect(isOrgAdmitted({ status: 'suspended', kyb_status: 'approved' })).toBe(false)
  })

  it('rejects a rejected org', () => {
    expect(isOrgAdmitted({ status: 'rejected', kyb_status: 'rejected' })).toBe(false)
  })
})
