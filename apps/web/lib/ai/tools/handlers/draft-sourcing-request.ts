export interface DraftSourcingRequestInput {
  title: string
  category?: string
  quantity?: number
  unit?: string
  target_price?: number
  currency?: string
  delivery_deadline?: string
  delivery_location?: string
  incoterms?: string
  payment_terms?: string
}

const MATERIAL_FIELDS: Array<{ key: keyof DraftSourcingRequestInput; label: string }> = [
  { key: 'quantity', label: 'quantity' },
  { key: 'delivery_deadline', label: 'delivery deadline' },
  { key: 'delivery_location', label: 'delivery location' },
  { key: 'incoterms', label: 'incoterms' },
  { key: 'payment_terms', label: 'payment terms' },
]

/**
 * Text/payload generation ONLY — this never calls create_marketplace_listing
 * or writes anything to the database. The buyer reviews the draft and
 * publishes it themselves through the existing listing-creation UI
 * (POST /api/marketplace/listings, a human-initiated request), exactly as
 * today. This tool's only job is drafting the payload and flagging what's
 * materially missing before that human step.
 */
export async function draftSourcingRequest(input: DraftSourcingRequestInput) {
  if (!input.title?.trim()) return { error: 'title is required' }

  const missing = MATERIAL_FIELDS.filter(f => input[f.key] == null || input[f.key] === '').map(f => f.label)

  return {
    draft: {
      listing_type: 'po_request',
      title: input.title.trim(),
      category: input.category ?? null,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      target_price: input.target_price ?? null,
      currency: input.currency ?? 'USD',
      delivery_deadline: input.delivery_deadline ?? null,
      delivery_location: input.delivery_location ?? null,
      incoterms: input.incoterms ?? null,
      payment_terms: input.payment_terms ?? null,
    },
    missing_material_fields: missing,
    message: missing.length > 0
      ? `Draft ready, but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} still missing — worth filling in before publishing.`
      : 'Draft looks complete. Review it and publish from the listing creation page when ready — I never publish this myself.',
  }
}
