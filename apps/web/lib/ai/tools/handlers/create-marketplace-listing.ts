import { adminClient } from '../admin'

interface LineItem {
  name: string
  description?: string
  quantity?: number
  unit?: string
  unit_price?: number
  specs?: Record<string, unknown>
  specs_flexible?: boolean
}

export interface CreateMarketplaceListingInput {
  org_id: string
  listing_type: 'po_request' | 'product_service'
  title: string
  description?: string
  category?: string
  currency?: string
  delivery_date?: string
  delivery_location?: string
  tags?: string[]
  visibility?: 'public' | 'network_only'
  network_id?: string
  line_items: LineItem[]
}

export async function createMarketplaceListing(input: CreateMarketplaceListingInput) {
  const currency = input.currency ?? 'USD'

  const { data: listing, error: listingErr } = await adminClient
    .from('marketplace_listings')
    .insert({
      org_id: input.org_id,
      listing_type: input.listing_type,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      currency,
      delivery_date: input.delivery_date ?? null,
      delivery_location: input.delivery_location ?? null,
      tags: input.tags ?? [],
      visibility: input.visibility ?? 'public',
      network_id: input.network_id ?? null,
      status: 'active',
    })
    .select('id, created_at')
    .single()

  if (listingErr || !listing) {
    return { error: `Failed to create listing: ${listingErr?.message}` }
  }

  const lineItemRows = input.line_items.map((item, idx) => ({
    listing_id: listing.id,
    name: item.name,
    description: item.description ?? null,
    quantity: item.quantity ?? null,
    unit: item.unit ?? 'units',
    unit_price: item.unit_price ?? null,
    currency,
    specs: item.specs ?? null,
    specs_flexible: item.specs_flexible ?? false,
    sort_order: idx,
  }))

  const { data: lineItems, error: lineItemsErr } = await adminClient
    .from('listing_line_items')
    .insert(lineItemRows)
    .select('id, name, quantity, unit, unit_price')

  if (lineItemsErr) {
    await adminClient.from('marketplace_listings').delete().eq('id', listing.id)
    return { error: `Failed to create line items: ${lineItemsErr.message}` }
  }

  const totalValue = input.line_items.reduce((sum, item) => {
    if (item.quantity && item.unit_price) return sum + item.quantity * item.unit_price
    return sum
  }, 0)

  return {
    listing_id: listing.id,
    line_item_ids: (lineItems ?? []).map((li: { id: string }) => li.id),
    line_items: lineItems ?? [],
    total_value: totalValue > 0 ? totalValue : null,
    currency,
    status: 'active',
    created_at: listing.created_at,
    url: `/marketplace/listings/${listing.id}`,
  }
}
