import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getImportableErpDeals } from '@/lib/ai/tools/handlers/get-importable-erp-deals'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 401 })
  if (userData.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const erpReference = body.erp_reference as string | undefined
  if (!erpReference) return NextResponse.json({ error: 'erp_reference is required' }, { status: 400 })

  // Re-derive the invoice from the synced ERP data — never trust client-supplied amounts.
  const result = await getImportableErpDeals(userData.org_id)
  if ('error' in result) return NextResponse.json(result, { status: 500 })

  const invoice = result.deals.find((d) => d.erp_reference === erpReference)
  if (!invoice) return NextResponse.json({ error: 'Invoice not found or already imported' }, { status: 404 })

  const { data: deal, error: dealErr } = await adminClient
    .from('deals')
    .insert({
      buyer_org_id: null,
      supplier_org_id: userData.org_id,
      deal_source: 'imported',
      status: 'confirmed',
      goods_description: `AR invoice ${invoice.invoice_name} — ${invoice.counterparty_name}`,
      total_value: invoice.amount,
      agreed_price: invoice.amount,
      agreed_currency: invoice.currency,
      external_counterparty_name: invoice.counterparty_name,
      agreed_delivery_date: invoice.due_date,
      erp_reference: invoice.erp_reference,
    })
    .select('id')
    .single()

  if (dealErr || !deal) return NextResponse.json({ error: `Failed to import: ${dealErr?.message}` }, { status: 500 })

  try {
    await adminClient.from('deal_events').insert({
      deal_id: deal.id,
      event_type: 'imported_from_erp',
      actor_user_id: userData.id,
      actor_org_id: userData.org_id,
      description: `Imported from ERP invoice ${invoice.invoice_name}`,
    })
  } catch { /* audit log is best-effort */ }

  return NextResponse.json({ ok: true, deal_id: deal.id })
}
