import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G4.1 — GET /api/invite/[token] — public route, no auth required
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: tokenRow } = await adminClient
    .from('network_invite_tokens')
    .select('id, token, network_id, anchor_org_id, invited_email, prefill_company_name, prefill_country, status, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!tokenRow) {
    return NextResponse.json({ valid: false, reason: 'not_found' })
  }

  if (tokenRow.status !== 'pending') {
    return NextResponse.json({ valid: false, reason: 'already_used' })
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, reason: 'expired' })
  }

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, name, anchor_org_id')
    .eq('id', tokenRow.network_id)
    .single()

  const { data: anchorOrg } = await adminClient
    .from('organizations')
    .select('legal_name, country, created_at')
    .eq('id', tokenRow.anchor_org_id)
    .single()

  return NextResponse.json({
    valid:                true,
    anchor_name:          anchorOrg?.legal_name ?? null,
    network_name:         network?.name ?? null,
    anchor_country:       anchorOrg?.country ?? null,
    anchor_member_since:  anchorOrg?.created_at ?? null,
    prefill_company_name: tokenRow.prefill_company_name,
    prefill_country:      tokenRow.prefill_country,
    invited_email:        tokenRow.invited_email,
  })
}
