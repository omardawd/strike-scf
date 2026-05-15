import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES   = ['bank_admin', 'bank_credit_officer']
const ANCHOR_ROLES = ['anchor_admin', 'anchor_member']

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: programId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id, email')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: program } = await adminClient
    .from('programs')
    .select('id, bank_id')
    .eq('id', programId)
    .single()
  if (!program) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  // ── BANK ─────────────────────────────────────────────────────────────────
  if (BANK_ROLES.includes(userData.role)) {
    if (program.bank_id !== userData.bank_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch enrollments AND pending invitations in parallel
    const [enrollResult, inviteResult, acceptedInviteResult] = await Promise.all([
      adminClient
        .from('program_enrollments')
        .select('org_id, anchor_org_id, status, created_at')
        .eq('program_id', programId)
        .in('status', ['active', 'invited']),
      adminClient
        .from('invitations')
        .select('id, email, role, created_at, anchor_org_id')
        .eq('program_id', programId)
        .eq('status', 'pending'),
      adminClient
        .from('invitations')
        .select('id, email, role, anchor_org_id')
        .eq('program_id', programId)
        .eq('status', 'accepted'),
    ])

    const enrollments = enrollResult.data ?? []
    const invitations = inviteResult.data ?? []

    // Build anchor → supplier map from enrollments, track enrollment dates
    const anchorMap = new Map<string, Set<string>>()
    const anchorEnrolledAt = new Map<string, string>()
    const supplierEnrolledAt = new Map<string, string>()
    for (const e of enrollments) {
      if (!e.anchor_org_id) continue
      if (!anchorMap.has(e.anchor_org_id)) anchorMap.set(e.anchor_org_id, new Set())
      if (e.org_id === e.anchor_org_id) {
        if (!anchorEnrolledAt.has(e.anchor_org_id)) anchorEnrolledAt.set(e.anchor_org_id, e.created_at)
      } else {
        anchorMap.get(e.anchor_org_id)!.add(e.org_id)
        if (!supplierEnrolledAt.has(e.org_id)) supplierEnrolledAt.set(e.org_id, e.created_at)
      }
    }

    // Process pending invitations
    const pending_anchors = invitations
      .filter(i => i.role === 'anchor')
      .map(i => ({
        id:         i.id,
        email:      i.email,
        status:     'invited' as const,
        invited_at: i.created_at,
        expires_at: null,
        type:       'invitation' as const,
      }))

    const pending_suppliers = invitations
      .filter(i => i.role === 'supplier')
      .map(i => ({
        id:             i.id,
        email:          i.email,
        anchor_org_id:  i.anchor_org_id,
        status:         'invited' as const,
        invited_at:     i.created_at,
        type:           'invitation' as const,
      }))

    const anchorIds = Array.from(anchorMap.keys())
    if (anchorIds.length === 0) {
      return NextResponse.json({ anchors: [], pending_anchors, pending_suppliers })
    }

    const allSupplierIds = Array.from(new Set(
      Array.from(anchorMap.values()).flatMap(s => Array.from(s))
    ))

    const [{ data: anchorOrgs }, txnsResult, supplierOrgsResult] = await Promise.all([
      adminClient
        .from('organizations')
        .select('id, legal_name, kyb_status, status')
        .in('id', anchorIds),
      adminClient
        .from('transactions')
        .select('anchor_id')
        .eq('program_id', programId)
        .in('anchor_id', anchorIds),
      allSupplierIds.length > 0
        ? adminClient
            .from('organizations')
            .select('id, legal_name, kyb_status, status')
            .in('id', allSupplierIds)
        : Promise.resolve({ data: [] as Array<{ id: string; legal_name: string; kyb_status: string; status: string }> }),
    ])

    const supplierOrgMap = new Map<string, { legal_name: string; kyb_status: string; status: string }>()
    for (const org of (supplierOrgsResult.data ?? [])) {
      supplierOrgMap.set(org.id, { legal_name: org.legal_name, kyb_status: org.kyb_status, status: org.status })
    }

    const txnCountByAnchor = new Map<string, number>()
    for (const t of (txnsResult.data ?? [])) {
      txnCountByAnchor.set(t.anchor_id, (txnCountByAnchor.get(t.anchor_id) ?? 0) + 1)
    }

    const anchors = (anchorOrgs ?? []).map(org => {
      const supplierIds = Array.from(anchorMap.get(org.id) ?? new Set<string>())
      const suppliers = supplierIds.map(sid => {
        const s = supplierOrgMap.get(sid) ?? { legal_name: '', kyb_status: 'draft', status: 'pending' }
        return { id: sid, ...s, enrolled_at: supplierEnrolledAt.get(sid) ?? null }
      })
      return {
        id:                org.id,
        legal_name:        org.legal_name,
        kyb_status:        org.kyb_status,
        status:            org.status,
        enrolled_at:       anchorEnrolledAt.get(org.id) ?? null,
        suppliers,
        supplier_count:    suppliers.length,
        pending_kyb_count: suppliers.filter(s => s.kyb_status === 'submitted').length,
        transaction_count: txnCountByAnchor.get(org.id) ?? 0,
      }
    })

    // ── Accepted invitations with pending KYB (signed up but not yet approved) ──
    const acceptedInvites = acceptedInviteResult.data ?? []
    const kyb_anchors: Array<{ id: string; legal_name: string; kyb_status: string }> = []
    const kyb_suppliers: Array<{ id: string; legal_name: string; kyb_status: string; anchor_org_id: string | null }> = []

    if (acceptedInvites.length > 0) {
      const acceptedEmails = acceptedInvites.map(i => i.email)
      const { data: inviteUsers } = await adminClient
        .from('users')
        .select('email, org_id')
        .in('email', acceptedEmails)

      const emailToOrgId = new Map<string, string>(
        (inviteUsers ?? []).filter(u => u.org_id).map(u => [u.email as string, u.org_id as string])
      )
      const kybOrgIds = Array.from(emailToOrgId.values())

      if (kybOrgIds.length > 0) {
        const { data: kybOrgs } = await adminClient
          .from('organizations')
          .select('id, legal_name, kyb_status, type')
          .in('id', kybOrgIds)
          .in('kyb_status', ['in_progress', 'submitted', 'under_review', 'more_info_requested'])

        const orgToEmail = new Map<string, string>()
        for (const [email, orgId] of emailToOrgId) orgToEmail.set(orgId, email)
        const emailToInvite = new Map(acceptedInvites.map(i => [i.email, i]))

        for (const org of (kybOrgs ?? [])) {
          const email = orgToEmail.get(org.id)
          const inv   = email ? emailToInvite.get(email) : null
          if (org.type === 'anchor') {
            kyb_anchors.push({ id: org.id, legal_name: org.legal_name, kyb_status: org.kyb_status })
          } else {
            kyb_suppliers.push({ id: org.id, legal_name: org.legal_name, kyb_status: org.kyb_status, anchor_org_id: inv?.anchor_org_id ?? null })
          }
        }
      }
    }

    return NextResponse.json({ anchors, pending_anchors, pending_suppliers, kyb_anchors, kyb_suppliers })
  }

  // ── ANCHOR ────────────────────────────────────────────────────────────────
  if (ANCHOR_ROLES.includes(userData.role)) {
    const [enrollCheck, inviteCheck] = await Promise.all([
      adminClient
        .from('program_enrollments')
        .select('id')
        .eq('program_id', programId)
        .eq('org_id', userData.org_id)
        .eq('status', 'active')
        .maybeSingle(),
      userData.email
        ? adminClient
            .from('invitations')
            .select('id')
            .eq('program_id', programId)
            .eq('email', userData.email as string)
            .in('status', ['pending', 'accepted'])
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    if (!enrollCheck.data && !inviteCheck.data) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [enrollResult, inviteResult, acceptedSupplierInviteResult] = await Promise.all([
      adminClient
        .from('program_enrollments')
        .select('org_id, created_at')
        .eq('program_id', programId)
        .eq('anchor_org_id', userData.org_id)
        .neq('org_id', userData.org_id)
        .in('status', ['active', 'invited']),
      adminClient
        .from('invitations')
        .select('id, email, created_at, anchor_org_id')
        .eq('program_id', programId)
        .eq('anchor_org_id', userData.org_id)
        .eq('status', 'pending'),
      adminClient
        .from('invitations')
        .select('id, email')
        .eq('program_id', programId)
        .eq('anchor_org_id', userData.org_id)
        .eq('status', 'accepted'),
    ])

    const pending_suppliers = (inviteResult.data ?? []).map(i => ({
      id:            i.id,
      email:         i.email,
      anchor_org_id: i.anchor_org_id,
      status:        'invited' as const,
      invited_at:    i.created_at,
      type:          'invitation' as const,
    }))

    const enrolledAtBySupplier = new Map((enrollResult.data ?? []).map((e: { org_id: string; created_at: string }) => [e.org_id, e.created_at]))
    const supplierIds = (enrollResult.data ?? []).map((e: { org_id: string }) => e.org_id)
    if (supplierIds.length === 0) {
      return NextResponse.json({ suppliers: [], pending_suppliers })
    }

    const [{ data: supplierOrgs }, { data: txns }] = await Promise.all([
      adminClient
        .from('organizations')
        .select('id, legal_name, kyb_status, status')
        .in('id', supplierIds),
      adminClient
        .from('transactions')
        .select('supplier_id, status')
        .eq('program_id', programId)
        .eq('anchor_id', userData.org_id)
        .in('supplier_id', supplierIds),
    ])

    const txnBySup = new Map<string, { count: number; latest_status: string }>()
    for (const t of (txns ?? [])) {
      const cur = txnBySup.get(t.supplier_id)
      txnBySup.set(t.supplier_id, { count: (cur?.count ?? 0) + 1, latest_status: t.status })
    }

    const suppliers = (supplierOrgs ?? []).map(org => ({
      id:                        org.id,
      legal_name:                org.legal_name,
      kyb_status:                org.kyb_status,
      status:                    org.status,
      enrolled_at:               enrolledAtBySupplier.get(org.id) ?? null,
      transaction_count:         txnBySup.get(org.id)?.count ?? 0,
      latest_transaction_status: txnBySup.get(org.id)?.latest_status ?? null,
    }))

    // Accepted invitations with pending KYB
    const acceptedSupplierEmails = (acceptedSupplierInviteResult.data ?? []).map(i => i.email)
    let kyb_suppliers: Array<{ id: string; legal_name: string; kyb_status: string }> = []

    if (acceptedSupplierEmails.length > 0) {
      const { data: supUsers } = await adminClient
        .from('users')
        .select('email, org_id')
        .in('email', acceptedSupplierEmails)

      const kybOrgIds = (supUsers ?? []).filter(u => u.org_id).map(u => u.org_id as string)
      if (kybOrgIds.length > 0) {
        const { data: kybOrgs } = await adminClient
          .from('organizations')
          .select('id, legal_name, kyb_status')
          .in('id', kybOrgIds)
          .in('kyb_status', ['in_progress', 'submitted', 'under_review', 'more_info_requested'])

        kyb_suppliers = (kybOrgs ?? []).map(o => ({ id: o.id, legal_name: o.legal_name, kyb_status: o.kyb_status }))
      }
    }

    return NextResponse.json({ suppliers, pending_suppliers, kyb_suppliers })
  }

  // ── SUPPLIER ──────────────────────────────────────────────────────────────
  const { data: myEnrollments } = await adminClient
    .from('program_enrollments')
    .select('anchor_org_id')
    .eq('program_id', programId)
    .eq('org_id', userData.org_id)
    .eq('status', 'active')

  let anchorIds2: string[] = [...new Set(
    (myEnrollments ?? [])
      .map((e: { anchor_org_id: string }) => e.anchor_org_id)
      .filter(Boolean)
  )]

  // No active enrollment yet — fall back to invitation to find the anchor
  if (anchorIds2.length === 0 && userData.email) {
    const { data: myInvitations } = await adminClient
      .from('invitations')
      .select('anchor_org_id')
      .eq('program_id', programId)
      .eq('email', userData.email as string)
      .in('status', ['pending', 'accepted'])

    anchorIds2 = [...new Set(
      (myInvitations ?? [])
        .map(i => i.anchor_org_id)
        .filter(Boolean) as string[]
    )]
  }

  if (anchorIds2.length === 0) return NextResponse.json({ anchors: [] })

  const [{ data: anchorOrgs2 }, { data: txns2 }] = await Promise.all([
    adminClient
      .from('organizations')
      .select('id, legal_name, kyb_status, status')
      .in('id', anchorIds2),
    adminClient
      .from('transactions')
      .select('anchor_id, status, financing_amount_approved')
      .eq('program_id', programId)
      .eq('supplier_id', userData.org_id)
      .in('anchor_id', anchorIds2),
  ])

  const txnByAnchor2 = new Map<string, { count: number; outstanding: number }>()
  for (const t of (txns2 ?? [])) {
    const cur = txnByAnchor2.get(t.anchor_id) ?? { count: 0, outstanding: 0 }
    txnByAnchor2.set(t.anchor_id, {
      count:       cur.count + 1,
      outstanding: cur.outstanding + (t.status === 'funded' ? (t.financing_amount_approved ?? 0) : 0),
    })
  }

  const anchors2 = (anchorOrgs2 ?? []).map(org => ({
    id:                  org.id,
    legal_name:          org.legal_name,
    kyb_status:          org.kyb_status,
    status:              org.status,
    transaction_count:   txnByAnchor2.get(org.id)?.count ?? 0,
    outstanding_balance: txnByAnchor2.get(org.id)?.outstanding ?? 0,
  }))

  return NextResponse.json({ anchors: anchors2 })
}
