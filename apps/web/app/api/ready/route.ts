import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

// Readiness check: the process is up AND its critical dependency (the
// database) is reachable. Intended for deploy-verification / load-balancer
// health checks, not general uptime monitoring (use /api/health for that —
// it's cheaper and has no dependency to fail on). Reveals only a boolean
// per dependency, never connection strings, error details, or any other
// configuration.
export async function GET() {
  const checks: Record<string, boolean> = {}

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      checks.database = false
    } else {
      const adminClient = createAdmin(supabaseUrl, serviceRoleKey)
      const { error } = await adminClient.from('banks').select('id').limit(1)
      checks.database = !error
    }
  } catch (err) {
    logger.warn('readiness check: database probe threw', { err: err instanceof Error ? err.message : String(err) })
    checks.database = false
  }

  const allReady = Object.values(checks).every(Boolean)
  return NextResponse.json(
    { status: allReady ? 'ready' : 'not_ready', checks, timestamp: new Date().toISOString() },
    { status: allReady ? 200 : 503 }
  )
}
