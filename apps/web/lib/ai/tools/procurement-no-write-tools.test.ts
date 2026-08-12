// Regression test: the standalone post-award procurement feature (PO ->
// receipt -> invoice -> discount, formerly PR 2) was removed — a PO/invoice
// is implicit in the po_request listing itself, so no separate post-award
// procurement lifecycle exists on a deal anymore. This asserts no AI tool
// definition set, and no ToolName member, resurrects any part of it.
import { describe, expect, it } from 'vitest'
import { STRIKE_TOOLS, TASK_CHAT_TOOLS } from './definitions'

const FORBIDDEN_NAME_PATTERN = /^(propose|confirm)_purchase_order$|^approve_invoice$|^(offer|accept)_invoice_discount$|^mark_(discount_)?paid$|^get_deal_procurement_status$|^draft_procurement_recommendation$/

describe('Post-award procurement AI tools removed', () => {
  it('STRIKE_TOOLS (the full tool set) contains no procurement/PO/invoice/discount tool', () => {
    const offending = STRIKE_TOOLS.filter(t => FORBIDDEN_NAME_PATTERN.test(t.name))
    expect(offending.map(t => t.name)).toEqual([])
  })

  it('TASK_CHAT_TOOLS (per-task plan chat) contains no such tool either', () => {
    const offending = TASK_CHAT_TOOLS.filter(t => FORBIDDEN_NAME_PATTERN.test(t.name))
    expect(offending.map(t => t.name)).toEqual([])
  })

  it('no tool name references procurement, purchase orders, deal invoices, or discounts', () => {
    const procurementTools = STRIKE_TOOLS.filter(t =>
      /procurement|purchase_order|deal_invoice|discount/.test(t.name)
    )
    expect(procurementTools.map(t => t.name)).toEqual([])
  })
})

// PR 3: "AI may NOT create a listing, send an invitation/message, submit/
// counter/accept/reject/award an offer, create a Deal, or change commercial
// terms — from ad hoc chat, dispatch, or autonomous execution."
describe('Pre-award sourcing AI write boundary (PR 3)', () => {
  it('the only pre-award sourcing tools are eligible-supplier lookup, two draft-only tools, and a non-binding award recommendation', () => {
    const sourcingTools = STRIKE_TOOLS.filter(t =>
      /eligible_suppliers|draft_sourcing|draft_supplier|recommend_award/.test(t.name)
    )
    const names = sourcingTools.map(t => t.name).sort()
    expect(names).toEqual([
      'draft_sourcing_request',
      'draft_supplier_outreach',
      'find_eligible_suppliers',
      'recommend_award',
    ])
  })

  it('recommend_award\'s own description states it never accepts an offer or creates a deal itself', () => {
    const tool = STRIKE_TOOLS.find(t => t.name === 'recommend_award')
    expect(tool).toBeDefined()
    expect(tool!.description).toMatch(/does not accept|non-binding/i)
  })

  it('draft_sourcing_request and draft_supplier_outreach are never given a create/send tool name', () => {
    const forbidden = /^publish_listing$|^create_listing$|^send_(supplier_)?(message|invitation|outreach)$/
    const offending = STRIKE_TOOLS.filter(t => forbidden.test(t.name))
    expect(offending.map(t => t.name)).toEqual([])
  })
})
