import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const countryCode = searchParams.get('country_code')

  if (countryCode) {
    const { data: signal, error } = await adminClient
      .from('market_signals')
      .select('*')
      .eq('signal_type', 'country_risk')
      .eq('country_code', countryCode)
      .maybeSingle()

    if (error) return NextResponse.json({ error: 'Failed to fetch signal' }, { status: 500 })

    return NextResponse.json({ signal, metadata: signal?.metadata ?? null })
  }

  const { data: signals, error } = await adminClient
    .from('market_signals')
    .select('*')
    .eq('signal_type', 'country_risk')
    .order('country_code', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch signals' }, { status: 500 })

  return NextResponse.json({ signals: signals ?? [] })
}
