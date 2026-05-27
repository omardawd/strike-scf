import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  let supabaseResponse = NextResponse.next({ request })

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
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // /api/risk/refresh-signals is cron-secret gated
  if (pathname === '/api/risk/refresh-signals') {
    const cronSecret = request.headers.get('x-cron-secret')
    if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return supabaseResponse
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (
    !user &&
    !pathname.startsWith('/api/') &&
    (pathname.startsWith('/dashboard') ||
      pathname.startsWith('/onboarding') ||
      pathname.startsWith('/kyb') ||
      pathname.startsWith('/programs') ||
      pathname.startsWith('/transactions') ||
      pathname.startsWith('/settings') ||
      pathname.startsWith('/reporting') ||
      pathname.startsWith('/collateral'))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const proxyConfig = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'
  ],
}
