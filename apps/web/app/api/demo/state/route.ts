import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { isDemoAccount } from '@/lib/demo'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET/POST /api/demo/state — tracks whether the demo@demo.com intro cinematic
// has played, so it auto-plays once and is otherwise only reachable via the
// "Replay demo" trigger. Scoped to the demo account only.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isDemoAccount(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data } = await adminClient
    .from('demo_account_state')
    .select('intro_played_at, last_reset_at')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    intro_played_at: data?.intro_played_at ?? null,
    last_reset_at: data?.last_reset_at ?? null,
  })
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isDemoAccount(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await adminClient
    .from('demo_account_state')
    .upsert({ user_id: user.id, intro_played_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: 'Failed to update demo state' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
