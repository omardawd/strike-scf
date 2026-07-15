import { adminClient } from '../admin'

export interface ImportableErpDeal {
  erp_reference: string
  counterparty_name: string
  amount: number
  currency: string
  due_date: string | null
  invoice_name: string
}

function partnerName(v: unknown): string {
  if (Array.isArray(v) && v.length === 2) return String(v[1])
  if (typeof v === 'string' && v) return v
  return 'Unknown counterparty'
}

// Surfaces individual AR invoices synced from the org's ERP that haven't yet been
// imported as a Strike deal, so they can be picked up and financed/managed on-platform.
export async function getImportableErpDeals(orgId: string): Promise<{ deals: ImportableErpDeal[] } | { error: string }> {
  const { data: conn } = await adminClient
    .from('erp_connections')
    .select('id, erp_type')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .single()

  if (!conn) return { deals: [] }

  const { data: arRow } = await adminClient
    .from('erp_sync_data')
    .select('data')
    .eq('org_id', orgId)
    .eq('data_type', 'ar_aging')
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoices: any[] = (arRow?.data as Record<string, unknown> | undefined)?.invoices as any[] ?? []
  if (!invoices.length) return { deals: [] }

  const { data: existing } = await adminClient
    .from('deals')
    .select('erp_reference')
    .eq('supplier_org_id', orgId)
    .not('erp_reference', 'is', null)

  const importedRefs = new Set((existing ?? []).map((d: { erp_reference: string }) => d.erp_reference))

  const deals: ImportableErpDeal[] = invoices
    .map((inv) => {
      const invoiceName = String(inv.name ?? inv.id ?? '')
      const erpReference = `erp:${conn.erp_type}:${invoiceName}`
      return {
        erp_reference: erpReference,
        counterparty_name: partnerName(inv.customer ?? inv.partner_id),
        amount: Number(inv.outstanding_amount ?? inv.amount_residual ?? 0),
        currency: typeof inv.currency === 'string' ? inv.currency : 'USD',
        due_date: (inv.due_date ?? inv.invoice_date_due ?? null) as string | null,
        invoice_name: invoiceName,
      }
    })
    .filter((d) => !importedRefs.has(d.erp_reference) && d.amount > 0)

  return { deals }
}
