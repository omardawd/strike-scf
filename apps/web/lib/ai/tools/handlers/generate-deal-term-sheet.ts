import { adminClient } from '../admin'

export interface GenerateDealTermSheetInput {
  deal_id: string
  include_financing?: boolean
}

export async function generateDealTermSheet(input: GenerateDealTermSheetInput) {
  const includeFinancing = input.include_financing !== false

  const { data: deal } = await adminClient
    .from('deals')
    .select(
      'id, deal_source, status, buyer_org_id, supplier_org_id, ' +
      'payment_due_date, payment_bank_name, payment_account_number, payment_routing_number, ' +
      'payment_swift_iban, payment_account_name, payment_reference, ' +
      'shipped_at, shipment_tracking_ref, shipment_carrier, shipment_estimated_delivery, ' +
      'contract_submitted_at, contract_supplier_signed_at, ' +
      'deal_invoice_document_id, deal_invoice_number, ' +
      'financing_payment_active, created_at, confirmed_at'
    )
    .eq('id', input.deal_id)
    .single()

  if (!deal) return { error: `Deal ${input.deal_id} not found` }

  const [{ data: orgs }, { data: lineItems }] = await Promise.all([
    adminClient
      .from('organizations')
      .select(
        'id, legal_name, doing_business_as, ein, business_type, ' +
        'address_line1, city, state, zip, country, ' +
        'primary_contact_name, primary_contact_email, primary_contact_phone, ' +
        'kyb_status, passport_score, risk_tier'
      )
      .in('id', [deal.buyer_org_id, deal.supplier_org_id]),
    adminClient
      .from('listing_line_items')
      .select('name, description, quantity, unit, unit_price, currency, specs')
      .eq('listing_id', input.deal_id)
      .limit(50),
  ])

  const orgMap = Object.fromEntries((orgs ?? []).map((o: { id: string }) => [o.id, o]))
  const buyer = orgMap[deal.buyer_org_id]
  const supplier = orgMap[deal.supplier_org_id]

  let finRequest = null
  let topFinancingOffer = null
  let linkedTransaction = null

  if (includeFinancing) {
    const { data: fr } = await adminClient
      .from('financing_requests')
      .select('id, status, created_at')
      .eq('deal_id', input.deal_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    finRequest = fr

    if (finRequest) {
      const [{ data: offer }, { data: txn }] = await Promise.all([
        adminClient
          .from('financing_request_offers')
          .select('bank_id, offered_rate_apr, offered_amount, offered_tenor_days, structure_type, status')
          .eq('request_id', finRequest.id)
          .eq('status', 'accepted')
          .limit(1)
          .single(),
        adminClient
          .from('transactions')
          .select(
            'id, type, status, financing_amount_approved, financing_rate_apr, tenor_days, ' +
            'disbursed_at, repayment_due_date, disbursement_reference'
          )
          .eq('financing_request_id', finRequest.id)
          .limit(1)
          .single(),
      ])
      linkedTransaction = txn

      if (offer) {
        const { data: bank } = await adminClient
          .from('banks')
          .select('legal_name, display_name')
          .eq('id', offer.bank_id)
          .single()
        topFinancingOffer = { ...offer, bank_name: bank?.display_name ?? bank?.legal_name ?? offer.bank_id }
      }
    }
  }

  const lineItemsData = lineItems ?? []
  const currency = (lineItemsData[0] as { currency?: string })?.currency ?? 'USD'
  const totalValue = lineItemsData.reduce((sum: number, li: { quantity: number | null; unit_price: number | null }) => {
    if (li.quantity && li.unit_price) return sum + Number(li.quantity) * Number(li.unit_price)
    return sum
  }, 0)

  return {
    term_sheet_id: `TS-${input.deal_id.slice(0, 8).toUpperCase()}`,
    deal_id: input.deal_id,
    generated_at: new Date().toISOString(),
    deal_status: deal.status,
    deal_source: deal.deal_source,
    parties: {
      buyer: buyer ? {
        legal_name: buyer.legal_name,
        doing_business_as: buyer.doing_business_as,
        ein: buyer.ein,
        business_type: buyer.business_type,
        address: [buyer.address_line1, buyer.city, buyer.state, buyer.zip, buyer.country].filter(Boolean).join(', '),
        contact: { name: buyer.primary_contact_name, email: buyer.primary_contact_email, phone: buyer.primary_contact_phone },
        kyb_status: buyer.kyb_status,
        passport_score: buyer.passport_score,
        risk_tier: buyer.risk_tier,
      } : { id: deal.buyer_org_id },
      supplier: supplier ? {
        legal_name: supplier.legal_name,
        doing_business_as: supplier.doing_business_as,
        ein: supplier.ein,
        business_type: supplier.business_type,
        address: [supplier.address_line1, supplier.city, supplier.state, supplier.zip, supplier.country].filter(Boolean).join(', '),
        contact: { name: supplier.primary_contact_name, email: supplier.primary_contact_email, phone: supplier.primary_contact_phone },
        kyb_status: supplier.kyb_status,
        passport_score: supplier.passport_score,
        risk_tier: supplier.risk_tier,
      } : { id: deal.supplier_org_id },
    },
    goods_and_services: {
      line_items: lineItemsData.map((li: { name: string; description: string | null; quantity: number | null; unit: string; unit_price: number | null; currency: string; specs: unknown }) => ({
        name: li.name,
        description: li.description,
        quantity: li.quantity,
        unit: li.unit,
        unit_price: li.unit_price,
        currency: li.currency ?? currency,
        line_total: li.quantity && li.unit_price ? Number(li.quantity) * Number(li.unit_price) : null,
        specs: li.specs,
      })),
      total_value: totalValue > 0 ? totalValue : null,
      currency,
    },
    commercial_terms: {
      invoice_number: deal.deal_invoice_number ?? null,
      payment_due_date: deal.payment_due_date ?? null,
      deal_confirmed_at: deal.confirmed_at ?? null,
    },
    payment_instructions: deal.payment_bank_name ? {
      bank_name: deal.payment_bank_name,
      account_name: deal.payment_account_name,
      account_number_last4: deal.payment_account_number ? String(deal.payment_account_number).slice(-4) : null,
      routing_number: deal.payment_routing_number,
      swift_iban: deal.payment_swift_iban,
      reference: deal.payment_reference,
    } : null,
    logistics: {
      shipped_at: deal.shipped_at ?? null,
      carrier: deal.shipment_carrier ?? null,
      tracking_ref: deal.shipment_tracking_ref ?? null,
      estimated_delivery: deal.shipment_estimated_delivery ?? null,
    },
    financing: includeFinancing && (topFinancingOffer || linkedTransaction) ? {
      request_id: finRequest?.id ?? null,
      request_status: finRequest?.status ?? null,
      financing_active: deal.financing_payment_active,
      accepted_offer: topFinancingOffer ? {
        bank_name: (topFinancingOffer as { bank_name?: string }).bank_name,
        structure: topFinancingOffer.structure_type,
        amount: topFinancingOffer.offered_amount,
        rate_apr: topFinancingOffer.offered_rate_apr,
        tenor_days: topFinancingOffer.offered_tenor_days,
      } : null,
      transaction: linkedTransaction ? {
        id: linkedTransaction.id, type: linkedTransaction.type, status: linkedTransaction.status,
        amount_approved: linkedTransaction.financing_amount_approved,
        rate_apr: linkedTransaction.financing_rate_apr,
        tenor_days: linkedTransaction.tenor_days,
        disbursed_at: linkedTransaction.disbursed_at,
        repayment_due: linkedTransaction.repayment_due_date,
      } : null,
    } : null,
    signatures: {
      contract_submitted: deal.contract_submitted_at ?? null,
      contract_signed: deal.contract_supplier_signed_at ?? null,
    },
  }
}
