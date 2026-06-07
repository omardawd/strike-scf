import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { runPassportRecalculate } from '@/lib/passport'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/passport/reviews  — submit a peer review for a completed deal
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!me.org_id) return NextResponse.json({ error: 'Org users only' }, { status: 403 })

  let body: {
    reviewed_org_id?: string
    deal_id?: string
    rating?: number
    category_scores?: {
      payment_speed: number
      communication: number
      accuracy: number
      reliability: number
    }
    comment?: string
    is_public?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { reviewed_org_id, deal_id, rating, category_scores, comment, is_public } = body

  if (!reviewed_org_id || !deal_id || rating == null) {
    return NextResponse.json(
      { error: 'reviewed_org_id, deal_id, and rating are required' },
      { status: 400 }
    )
  }
  if (rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
  }

  // Validate deal — must be completed and current org must be a party
  const { data: deal } = await adminClient
    .from('deals')
    .select('id, status, buyer_org_id, supplier_org_id')
    .eq('id', deal_id)
    .single()

  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  if (deal.status !== 'completed') {
    return NextResponse.json(
      { error: 'Deal must be completed before leaving a review' },
      { status: 400 }
    )
  }
  if (deal.buyer_org_id !== me.org_id && deal.supplier_org_id !== me.org_id) {
    return NextResponse.json({ error: 'You must be a party to this deal' }, { status: 403 })
  }
  if (deal.buyer_org_id !== reviewed_org_id && deal.supplier_org_id !== reviewed_org_id) {
    return NextResponse.json(
      { error: 'Reviewed org is not a party to this deal' },
      { status: 400 }
    )
  }
  if (reviewed_org_id === me.org_id) {
    return NextResponse.json({ error: 'Cannot review your own organization' }, { status: 400 })
  }

  // Check no existing review from this org for this deal
  const { data: existing } = await adminClient
    .from('passport_peer_reviews')
    .select('id')
    .eq('reviewing_org_id', me.org_id)
    .eq('deal_id', deal_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'You have already reviewed this deal' },
      { status: 409 }
    )
  }

  const { data: review, error } = await adminClient
    .from('passport_peer_reviews')
    .insert({
      reviewing_org_id: me.org_id,
      reviewed_org_id,
      deal_id,
      rating,
      category_scores: category_scores ?? null,
      comment: comment ? comment.trim().slice(0, 500) : null,
      is_public: is_public !== false,
    })
    .select()
    .single()

  if (error || !review) {
    console.error('[passport/reviews] insert failed:', error)
    return NextResponse.json({ error: 'Failed to save review' }, { status: 500 })
  }

  // Fire-and-forget: recalculate reviewed org's PassportScore
  void runPassportRecalculate(reviewed_org_id).catch((e) =>
    console.error('[passport/reviews] recalculate failed:', e)
  )

  return NextResponse.json({ review }, { status: 201 })
}
