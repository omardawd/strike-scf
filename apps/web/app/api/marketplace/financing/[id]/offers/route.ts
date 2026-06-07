import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, extractJson, AI_MODEL } from '@/lib/ai'
import type { SubmitFinancingOfferPayload } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requestId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!BANK_ROLES.includes(me.role)) {
    return NextResponse.json({ error: 'Only bank users can submit financing offers' }, { status: 403 })
  }

  if (!me.bank_id) {
    return NextResponse.json({ error: 'Bank association required' }, { status: 403 })
  }

  let body: SubmitFinancingOfferPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.offered_rate_apr || !body.offered_amount || !body.offered_tenor_days || !body.structure_type) {
    return NextResponse.json({
      error: 'offered_rate_apr, offered_amount, offered_tenor_days, and structure_type are required',
    }, { status: 400 })
  }

  const { data: financingReq } = await adminClient
    .from('financing_requests')
    .select('id, status, preferred_tenor_days, amount_requested')
    .eq('id', requestId)
    .single()

  if (!financingReq) return NextResponse.json({ error: 'Financing request not found' }, { status: 404 })
  if (!['open', 'offers_received'].includes(financingReq.status)) {
    return NextResponse.json({ error: 'Financing request is no longer accepting offers' }, { status: 400 })
  }

  // Upsert on (request_id, bank_id)
  const { data: offer, error: upsertError } = await adminClient
    .from('financing_request_offers')
    .upsert({
      request_id:         requestId,
      bank_id:            me.bank_id,
      offered_rate_apr:   body.offered_rate_apr,
      offered_amount:     body.offered_amount,
      offered_tenor_days: body.offered_tenor_days,
      structure_type:     body.structure_type,
      conditions:         body.conditions ?? null,
      notes:              body.notes ?? null,
      status:             'pending',
      submitted_at:       new Date().toISOString(),
    }, {
      onConflict: 'request_id,bank_id',
    })
    .select()
    .single()

  if (upsertError || !offer) {
    console.error('Offer upsert error:', upsertError)
    return NextResponse.json({ error: 'Failed to submit offer' }, { status: 500 })
  }

  // AI score vs competing offers (non-fatal)
  try {
    const { data: allOffers } = await adminClient
      .from('financing_request_offers')
      .select('id, offered_rate_apr, offered_amount, offered_tenor_days, structure_type, bank_id')
      .eq('request_id', requestId)
      .neq('id', offer.id)

    if (allOffers && allOffers.length > 0) {
      const preferredTenor = financingReq.preferred_tenor_days ?? body.offered_tenor_days
      const offersJson = JSON.stringify(allOffers.map((o: any) => ({
        rate_apr:   o.offered_rate_apr,
        amount:     o.offered_amount,
        tenor_days: o.offered_tenor_days,
        structure:  o.structure_type,
      })))

      const { text } = await callClaude({
        system: 'You are Strike AI. Return only valid JSON. No prose.',
        messages: [{
          role: 'user',
          content: `Given these competing offers on a financing request: ${offersJson}. Score the new offer from 0-100 vs the alternatives on: rate competitiveness, tenor fit (preferred: ${preferredTenor}), amount coverage. The new offer: rate_apr=${body.offered_rate_apr}, amount=${body.offered_amount}, tenor_days=${body.offered_tenor_days}. Return JSON only: {"score": number, "reasoning": "1 sentence"}`,
        }],
        max_tokens: 200,
      })

      const parsed = extractJson<{ score: number; reasoning: string }>(text)
      if (parsed && typeof parsed.score === 'number') {
        await adminClient
          .from('financing_request_offers')
          .update({
            ai_score:           Math.max(0, Math.min(100, Math.round(parsed.score))),
            ai_score_reasoning: parsed.reasoning ?? null,
          })
          .eq('id', offer.id)

        offer.ai_score           = parsed.score
        offer.ai_score_reasoning = parsed.reasoning
      }

      await adminClient.from('ai_usage').insert({
        user_id: user.id, bank_id: me.bank_id, feature: 'insight',
        tokens_input: 0, tokens_output: 0, tokens_total: 0, model: AI_MODEL,
      })
    }
  } catch (err) {
    console.error('AI scoring failed (non-fatal):', err)
  }

  // Update request status to offers_received + increment offer_count
  await adminClient
    .from('financing_requests')
    .update({
      status:      'offers_received',
      offer_count: (financingReq as any).offer_count + 1,
    })
    .eq('id', requestId)
    .eq('status', 'open')

  // Notify the requesting org's users
  try {
    const { data: reqFull } = await adminClient
      .from('financing_requests')
      .select('requesting_org_id')
      .eq('id', requestId)
      .single()

    if (reqFull?.requesting_org_id) {
      const { data: orgUsers } = await adminClient
        .from('users')
        .select('id')
        .eq('org_id', reqFull.requesting_org_id)

      if (orgUsers && orgUsers.length > 0) {
        const { data: bank } = await adminClient
          .from('banks')
          .select('display_name')
          .eq('id', me.bank_id)
          .single()

        const bankName = bank?.display_name ?? 'A bank'

        await adminClient.from('notifications').insert(
          orgUsers.map((u: any) => ({
            user_id:   u.id,
            event:     'financing_offer_received',
            title:     'New Financing Offer',
            body:      `${bankName} submitted a financing offer of ${body.offered_amount} at ${body.offered_rate_apr}% APR.`,
            deep_link: `/marketplace/financing/${requestId}`,
            read:      false,
          }))
        )
      }
    }
  } catch (err) {
    console.error('Notification failed (non-fatal):', err)
  }

  return NextResponse.json({ offer }, { status: 201 })
}
