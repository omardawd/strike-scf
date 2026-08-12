import { NextResponse } from 'next/server'

// Liveness check: the process is up and able to handle a request. No
// dependency checks (that's /api/ready) and no secrets/config revealed —
// safe to hit unauthenticated from an uptime monitor.
export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() })
}
