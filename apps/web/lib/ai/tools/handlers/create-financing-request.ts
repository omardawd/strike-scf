import { adminClient } from '../admin'

interface Input {
  org_id: string
  // Either provide an existing deal_id, or supply invoice details to auto-import
  deal_id?: string
  // Fields for auto-importing the invoice as a deal
  invoice_description?: string
  // Required when creating a new imported deal; optional when deal_id is given
  // (defaults from the deal's own value — see below).
  amount?: number
  currency?: string
  counterparty_name?: string
  invoice_due_date?: string
  // Financing terms
  structure_type?: 'preset' | 'custom' | 'open'
  financing_type?: 'invoice_factoring' | 'reverse_factoring' | 'po_financing' | 'dynamic_discounting'
  preferred_tenor_days?: number
  preferred_rate_max?: number
}

export async function createFinancingRequest(input: Input, userId = '') {
  const {
    org_id,
    deal_id: existingDealId,
    invoice_description,
    currency = 'USD',
    counterparty_name,
    preferred_tenor_days = 60,
    preferred_rate_max,
    structure_type = 'open',
    financing_type = 'invoice_factoring',
  } = input
  let amount = input.amount

  // ── Step 1: Resolve or create the deal ───────────────────────────────────────
  let dealId = existingDealId

  if (dealId && amount == null) {
    // The agent proposed financing against an existing deal without restating
    // the amount — default it from the deal's own agreed value instead of
    // failing the not-null constraint on financing_requests.amount_requested.
    const { data: deal } = await adminClient
      .from('deals')
      .select('total_value, agreed_price')
      .eq('id', dealId)
      .single()
    amount = deal?.total_value ?? deal?.agreed_price ?? undefined
  }

  if (amount == null) throw new Error('amount is required (either directly, or derivable from deal_id)')

  if (!dealId) {
    // Import the ERP invoice as a Strike deal
    const description = invoice_description ?? (counterparty_name ? `AR invoice — ${counterparty_name}` : 'Imported receivable')

    const dealRow: Record<string, unknown> = {
      supplier_org_id: org_id,
      deal_source: 'imported',
      status: 'confirmed',
      goods_description: description,
      total_value: amount,
      agreed_price: amount,
      agreed_currency: currency,
      financing_requested: true,
      financing_requested_at: new Date().toISOString(),
    }
    if (counterparty_name) dealRow.external_counterparty_name = counterparty_name
    if (input.invoice_due_date) dealRow.agreed_delivery_date = input.invoice_due_date
    // buyer_org_id intentionally omitted for imported AR — buyer is an external counterparty

    const { data: deal, error: dealErr } = await adminClient
      .from('deals')
      .insert(dealRow)
      .select('id')
      .single()

    if (dealErr || !deal) throw new Error(`Failed to import deal: ${dealErr?.message}`)
    dealId = deal.id
  }

  // ── Step 2: Create the financing request ─────────────────────────────────────
  const { data: fr, error: frErr } = await adminClient
    .from('financing_requests')
    .insert({
      deal_id: dealId,
      requesting_org_id: org_id,
      structure_type,
      financing_type,
      amount_requested: amount,
      preferred_tenor_days,
      preferred_rate_max: preferred_rate_max ?? null,
      currency,
      status: 'open',
    })
    .select('id, amount_requested, currency, status, created_at')
    .single()

  if (frErr || !fr) throw new Error(`Failed to create financing request: ${frErr?.message}`)

  // action_type now a valid agent_action_type value (migration 00000000000024).
  // approved_by_user_id is a uuid column — the sole caller (execute.ts) never
  // passes userId, so this was always '' and always failed the uuid cast
  // (silently, via the swallowed catch below). Use null when absent instead.
  const { error: logError } = await adminClient.from('agent_actions').insert({
    org_id: org_id,
    action_type: 'create_financing_request',
    entity_type: 'financing_request',
    entity_id: fr.id,
    input_summary: JSON.stringify({ amount, currency, financing_type, preferred_tenor_days }),
    output_summary: `Financing request ${fr.id} created for ${currency} ${amount}`,
    outcome: 'success',
    requires_approval: false,
    human_approved: true,
    approved_by_user_id: userId || null,
    model: 'tool',
    tokens_used: 0,
  })
  if (logError) console.error('[create-financing-request] agent_actions log failed:', logError)

  return {
    financing_request_id: fr.id,
    deal_id: dealId,
    amount_requested: fr.amount_requested,
    currency: fr.currency,
    status: fr.status,
    financing_type,
    preferred_tenor_days,
    url: `/marketplace/financing/${fr.id}`,
    message: `Financing request posted successfully. Financiers can now submit offers on Strike Place at /marketplace/financing/${fr.id}.`,
  }
}
