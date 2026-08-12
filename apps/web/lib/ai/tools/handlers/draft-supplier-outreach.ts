import { adminClient } from '../admin'

export type ToolActor = { userId: string; orgId: string | null; bankId: string | null }

export interface DraftSupplierOutreachInput {
  listing_id: string
  target_org_id: string
}

/**
 * Text generation ONLY — this never sends an email, notification, or
 * invitation. The buyer copies the draft and sends it themselves (e.g. via
 * the existing network invite flow, or directly), same as
 * draft-sourcing-request.ts.
 */
export async function draftSupplierOutreach(input: DraftSupplierOutreachInput, actor?: ToolActor) {
  if (!actor?.orgId) return { error: 'An authenticated organization user is required' }

  const { data: listing } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id, title, quantity, unit, delivery_deadline, delivery_location, target_price, currency')
    .eq('id', input.listing_id)
    .single()
  if (!listing) return { error: 'Listing not found' }
  if (listing.org_id !== actor.orgId) return { error: 'Forbidden — only the listing owner can draft outreach for their own listing' }

  const { data: targetOrg } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as')
    .eq('id', input.target_org_id)
    .single()
  if (!targetOrg) return { error: 'Target organization not found' }

  const targetName = targetOrg.doing_business_as || targetOrg.legal_name || 'there'
  const quantityLine = listing.quantity ? `${listing.quantity} ${listing.unit ?? ''}`.trim() : null

  const draftMessage = [
    `Hi ${targetName},`,
    '',
    `We're sourcing "${listing.title}"${quantityLine ? ` (${quantityLine})` : ''} on Strike and would welcome a quote from you.`,
    listing.delivery_deadline ? `Target delivery: ${listing.delivery_deadline}${listing.delivery_location ? ` to ${listing.delivery_location}` : ''}.` : null,
    listing.target_price ? `Indicative budget: ${listing.target_price} ${listing.currency}.` : null,
    '',
    'Let us know if you have any questions — happy to clarify anything before you submit an offer.',
  ].filter(Boolean).join('\n')

  return {
    listing_id: input.listing_id,
    target_org_id: input.target_org_id,
    draft_message: draftMessage,
    message: 'Draft only — nothing has been sent. Send this yourself through the network invite flow or your own channel.',
  }
}
