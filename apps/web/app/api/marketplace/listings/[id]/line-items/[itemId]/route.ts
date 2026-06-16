// PATCH / DELETE for a single line item.
// PATCH  /api/marketplace/listings/[id]/line-items/[itemId]
// DELETE /api/marketplace/listings/[id]/line-items/[itemId]
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Ctx = { params: Promise<{ id: string; itemId: string }> }

async function resolveActor(userId: string) {
  const { data } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', userId)
    .single()
  return data
}

async function verifyOwnership(itemId: string, listingId: string, orgId: string): Promise<boolean> {
  const { data } = await adminClient
    .from('listing_line_items')
    .select('id, listing_id, marketplace_listings!inner(org_id)')
    .eq('id', itemId)
    .eq('listing_id', listingId)
    .single()
  if (!data) return false
  const listing = (data as { marketplace_listings: { org_id: string } | { org_id: string }[] }).marketplace_listings
  const orgIdFromListing = Array.isArray(listing) ? listing[0]?.org_id : listing?.org_id
  return orgIdFromListing === orgId
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id: listingId, itemId } = await ctx.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actor = await resolveActor(user.id)
  if (!actor?.org_id) return NextResponse.json({ error: 'Not an org user' }, { status: 403 })
  if (!['org_admin', 'org_member'].includes(actor.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!await verifyOwnership(itemId, listingId, actor.org_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const allowed = ['name', 'description', 'quantity', 'unit', 'unit_price', 'currency', 'specs', 'sort_order']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data: item, error } = await adminClient
    .from('listing_line_items')
    .update(patch)
    .eq('id', itemId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item })
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id: listingId, itemId } = await ctx.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actor = await resolveActor(user.id)
  if (!actor?.org_id) return NextResponse.json({ error: 'Not an org user' }, { status: 403 })
  if (!['org_admin', 'org_member'].includes(actor.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!await verifyOwnership(itemId, listingId, actor.org_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminClient
    .from('listing_line_items')
    .delete()
    .eq('id', itemId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
