// Single source of truth for a listing's total price. target_price on
// marketplace_listings is NEVER client-settable (stripped from every write
// route) — it only ever reflects sum(quantity * unit_price) across that
// listing's listing_line_items, recomputed here after every line-item
// create/update/delete. This mirrors what the listings GET route already
// computes live as `line_items_total`, but keeps target_price itself correct
// for every other reader (financing pages, admin, PDF exports, AI tools)
// that reads the listing row directly without doing that join.
import type { SupabaseClient } from '@supabase/supabase-js'

export async function recomputeListingTotal(
  adminClient: SupabaseClient,
  listingId: string
): Promise<number | null> {
  const { data: items } = await adminClient
    .from('listing_line_items')
    .select('quantity, unit_price')
    .eq('listing_id', listingId)

  let total = 0
  let hasPriced = false
  for (const item of items ?? []) {
    const qty = Number(item.quantity) || 0
    const price = Number(item.unit_price) || 0
    if (qty > 0 && price > 0) {
      total += qty * price
      hasPriced = true
    }
  }

  const target_price = hasPriced ? total : null
  await adminClient.from('marketplace_listings').update({ target_price }).eq('id', listingId)
  return target_price
}

export interface LineItemInput {
  name: string
  description?: string | null
  quantity: number
  unit?: string | null
  unit_price: number
  currency?: string
  specs?: unknown
  sort_order?: number
}

// Every line item on a listing must carry real pricing — quantity and
// unit_price are required, not optional, so a listing's total can never be a
// number someone typed in directly. Returns the first validation error found,
// or null if every item is priced correctly.
export function validateLineItems(items: LineItemInput[]): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return 'At least one priced line item is required to publish a listing.'
  }
  for (const item of items) {
    if (!item.name?.trim()) {
      return 'Every line item needs a name.'
    }
    if (!(Number(item.quantity) > 0)) {
      return `"${item.name}" is missing a quantity — quantity is required for every line item.`
    }
    if (!(Number(item.unit_price) > 0)) {
      return `"${item.name}" is missing a unit price — pricing is required for every line item.`
    }
  }
  return null
}
