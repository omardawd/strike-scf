import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { assertPublicHttpUrl } from '@/lib/ssrf'

// Node runtime: the SSRF guard uses node:dns / node:net.
export const runtime = 'nodejs'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── ERPNext ───────────────────────────────────────────────────────────────────

async function validateErpNextCredentials(baseUrl: string, apiKey: string, apiSecret: string) {
  const res = await fetch(`${baseUrl}/api/method/frappe.auth.get_logged_user`, {
    headers: { Authorization: `token ${apiKey}:${apiSecret}` },
  })
  if (!res.ok) throw new Error(`ERPNext responded ${res.status}`)
  const data = await res.json()
  if (!data.message) throw new Error('Unexpected ERPNext response')
  return data.message as string
}

// ── Odoo ──────────────────────────────────────────────────────────────────────

function xmlEnc(v: unknown): string {
  if (v === null || v === undefined) return '<nil/>'
  if (typeof v === 'boolean') return `<boolean>${v ? 1 : 0}</boolean>`
  if (typeof v === 'number' && Number.isInteger(v)) return `<int>${v}</int>`
  if (typeof v === 'number') return `<double>${v}</double>`
  if (typeof v === 'string') return `<string>${v.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</string>`
  if (Array.isArray(v)) return `<array><data>${v.map(i=>`<value>${xmlEnc(i)}</value>`).join('')}</data></array>`
  if (typeof v === 'object') {
    const m = Object.entries(v as Record<string,unknown>).map(([k,val])=>`<member><name>${k}</name><value>${xmlEnc(val)}</value></member>`).join('')
    return `<struct>${m}</struct>`
  }
  return `<string>${v}</string>`
}

async function validateOdooCredentials(baseUrl: string, dbName: string, email: string, apiKey: string) {
  // Use XML-RPC authenticate — the only method that works reliably on odoo.com SaaS + all versions
  const body = `<?xml version='1.0'?><methodCall><methodName>authenticate</methodName><params>${[dbName, email, apiKey, {}].map(p=>`<param><value>${xmlEnc(p)}</value></param>`).join('')}</params></methodCall>`
  const res = await fetch(`${baseUrl}/xmlrpc/2/common`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body,
  })
  if (!res.ok) throw new Error(`Odoo responded ${res.status} — check your URL`)
  const xml = await res.text()

  if (xml.includes('<fault>')) {
    const msg = xml.match(/<name>faultString<\/name>\s*<value><string>([\s\S]*?)<\/string>/)?.[1]?.trim()
    throw new Error(msg ?? 'Odoo authentication error')
  }

  const intMatch = xml.match(/<int>(\d+)<\/int>/) ?? xml.match(/<i4>(\d+)<\/i4>/)
  if (!intMatch) throw new Error('Unexpected Odoo response — check database name and URL')
  const uid = parseInt(intMatch[1] ?? '0')
  if (uid === 0) throw new Error('Invalid credentials — check email and API key')
  return `Odoo user #${uid}`
}

// ── Handlers ──────────────────────────────────────────────────────────────────

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
  const { erp_type, base_url, api_key, api_secret, db_name } = body
  const cleanUrl = (base_url as string)?.replace(/\/$/, '')

  if (!erp_type || !cleanUrl || !api_key || !api_secret) {
    return NextResponse.json({ error: 'erp_type, base_url, api_key, and api_secret are required' }, { status: 400 })
  }

  if (!['erpnext', 'odoo'].includes(erp_type)) {
    return NextResponse.json({ error: 'Unsupported ERP type' }, { status: 400 })
  }

  // SSRF guard: cleanUrl is fetched server-side below, so it must be a public
  // http(s) endpoint — never internal/loopback/cloud-metadata addresses.
  try {
    await assertPublicHttpUrl(cleanUrl)
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid ERP URL: ${err instanceof Error ? err.message : 'not permitted'}` },
      { status: 400 }
    )
  }

  let erpUser: string
  try {
    if (erp_type === 'erpnext') {
      erpUser = await validateErpNextCredentials(cleanUrl, api_key, api_secret)
    } else {
      // For Odoo.com: db name defaults to the subdomain
      const resolvedDb = db_name || new URL(cleanUrl).hostname.split('.')[0]
      erpUser = await validateOdooCredentials(cleanUrl, resolvedDb, api_key, api_secret)
    }
  } catch (err) {
    return NextResponse.json({
      error: `Could not connect to ${erp_type === 'odoo' ? 'Odoo' : 'ERPNext'}: ${err instanceof Error ? err.message : 'unknown error'}`,
    }, { status: 422 })
  }

  const extraConfig = erp_type === 'odoo'
    ? { db_name: db_name || new URL(cleanUrl).hostname.split('.')[0] }
    : {}

  const { data: conn, error } = await adminClient
    .from('erp_connections')
    .upsert(
      {
        org_id: userData.org_id,
        erp_type,
        base_url: cleanUrl,
        api_key,
        api_secret,
        extra_config: extraConfig,
        status: 'active',
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id' }
    )
    .select('id, dispatch_token, status')
    .single()

  if (error) return NextResponse.json({ error: `Failed to save connection: ${error.message}` }, { status: 500 })

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
