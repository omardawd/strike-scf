import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Validate ERPNext credentials by calling the whoami endpoint.
async function validateErpNextCredentials(baseUrl: string, apiKey: string, apiSecret: string) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/method/frappe.auth.get_logged_user`
  const res = await fetch(url, {
    headers: { Authorization: `token ${apiKey}:${apiSecret}` },
  })
  if (!res.ok) throw new Error(`ERPNext responded ${res.status}`)
  const data = await res.json()
  if (!data.message) throw new Error('Unexpected ERPNext response')
  return data.message as string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 401 })
  if (userData.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { erp_type, base_url, api_key, api_secret } = body

  if (!erp_type || !base_url || !api_key || !api_secret) {
    return NextResponse.json({ error: 'erp_type, base_url, api_key, and api_secret are required' }, { status: 400 })
  }

  if (erp_type !== 'erpnext') {
    return NextResponse.json({ error: 'Only ERPNext is supported in this release' }, { status: 400 })
  }

  // Validate credentials against the live ERPNext site
  let erpUser: string
  try {
    erpUser = await validateErpNextCredentials(base_url, api_key, api_secret)
  } catch (err) {
    return NextResponse.json({
      error: `Could not connect to ERPNext: ${err instanceof Error ? err.message : 'unknown error'}`,
    }, { status: 422 })
  }

  // Upsert connection (one per org)
  const { data: conn, error } = await adminClient
    .from('erp_connections')
    .upsert(
      {
        org_id: userData.org_id,
        erp_type,
        base_url: base_url.replace(/\/$/, ''),
        api_key,
        api_secret,
        status: 'active',
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id' }
    )
    .select('id, dispatch_token, status')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 })

  return NextResponse.json({
    ok: true,
    connection_id: conn.id,
    dispatch_token: conn.dispatch_token,
    erp_user: erpUser,
  })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 401 })
  if (userData.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await adminClient
    .from('erp_connections')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('org_id', userData.org_id)

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ connection: null })

  const { data: conn } = await adminClient
    .from('erp_connections')
    .select('id, erp_type, base_url, status, last_synced_at, error_message, dispatch_token, created_at')
    .eq('org_id', userData.org_id)
    .neq('status', 'disconnected')
    .single()

  return NextResponse.json({ connection: conn ?? null })
}
