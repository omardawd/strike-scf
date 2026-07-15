import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getImportableErpDeals } from '@/lib/ai/tools/handlers/get-importable-erp-deals'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ deals: [] })

  const result = await getImportableErpDeals(userData.org_id)
  if ('error' in result) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
