// CRUD for listing_line_items.
// GET    /api/marketplace/listings/[id]/line-items
// POST   /api/marketplace/listings/[id]/line-items          — add item
// PATCH  /api/marketplace/listings/[id]/line-items/[itemId] lives in [itemId]/route.ts
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Ctx = { params: Promise<{ id: string }> }

async function resolveActor(userId: string) {
  const { data } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', userId)
    .single()
  return data
}

async function ownsListing(listingId: string, orgId: string) {
  const { data } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id')
    .eq('id', listingId)
    .single()
  return data?.org_id === orgId
}

export async function GET(req: Request, ctx: Ctx) {
  const { id: listingId } = await ctx.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: items, error } = await adminClient
    .from('listing_line_items')
    .select('*')
    .eq('listing_id', listingId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: items ?? [] })
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: listingId } = await ctx.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actor = await resolveActor(user.id)
  if (!actor?.org_id) return NextResponse.json({ error: 'Not an org user' }, { status: 403 })
  if (!['org_admin', 'org_member'].includes(actor.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!await ownsListing(listingId, actor.org_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { name, description, quantity, unit, unit_price, currency, specs, sort_order } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const { data: item, error } = await adminClient
    .from('listing_line_items')
    .insert({
      listing_id: listingId,
      name: name.trim(),
      description: description?.trim() ?? null,
      quantity: quantity ?? null,
      unit: unit?.trim() ?? null,
      unit_price: unit_price ?? null,
      currency: currency?.trim() ?? 'USD',
      specs: specs ?? [],
      sort_order: sort_order ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item }, { status: 201 })
}
