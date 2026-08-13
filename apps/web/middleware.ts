import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Correlation ID propagation (Track H — observability foundation): every
// request gets an x-request-id, either passed through from an upstream
// caller/load balancer or generated fresh here. Set on both the forwarded
// request (so route handlers' logger calls can read and include it) and
// the response (so callers can correlate their own logs/support tickets).
function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId)
  return response
}

// TEMPORARY: when DISABLE_AUTH=true, every unauthenticated visitor is silently
// signed in as this dev account instead of being sent to /login. Set DISABLE_AUTH=true
// in Vercel env vars to enable, remove/unset it (and redeploy) to revert.
const NO_AUTH_EMAIL = 'jfurner@walmart.com'
const NO_AUTH_PASSWORD = 'DevPass123!'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  if (pathname.includes('..')) {
    return withRequestId(NextResponse.json({ error: 'Invalid path' }, { status: 400 }), requestId)
  }

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && process.env.DISABLE_AUTH === 'true') {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: NO_AUTH_EMAIL,
      password: NO_AUTH_PASSWORD,
    })
    if (!error) {
      user = data.user
    }
  }

  if (process.env.DISABLE_AUTH === 'true' && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/home'
    return withRequestId(NextResponse.redirect(url), requestId)
  }

  // /api/risk/refresh-signals is cron-secret gated
  if (pathname === '/api/risk/refresh-signals') {
    const cronSecret = request.headers.get('x-cron-secret')
    if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
      return withRequestId(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), requestId)
    }
    return withRequestId(supabaseResponse, requestId)
  }

  // Authenticated-only API routes
  const AUTHED_API_PREFIXES = [
    '/api/ai/chat',
    '/api/ai/usage',
    '/api/risk/score',
    '/api/recommendations',
    '/api/performance/',
    '/api/graph',
  ]
  if (!user && AUTHED_API_PREFIXES.some(p => pathname.startsWith(p))) {
    return withRequestId(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), requestId)
  }

  if (
    !user &&
    !pathname.startsWith('/api/') &&
    (pathname.startsWith('/dashboard') ||
      pathname.startsWith('/home') ||
      pathname.startsWith('/onboarding') ||
      pathname.startsWith('/kyb') ||
      pathname.startsWith('/programs') ||
      pathname.startsWith('/transactions') ||
      pathname.startsWith('/settings') ||
      pathname.startsWith('/reporting') ||
      pathname.startsWith('/collateral') ||
      pathname.startsWith('/marketplace') ||
      pathname.startsWith('/deals') ||
      pathname.startsWith('/rooms') ||
      pathname.startsWith('/passport'))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRequestId(NextResponse.redirect(url), requestId)
  }

  return withRequestId(supabaseResponse, requestId)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'
  ],
}
