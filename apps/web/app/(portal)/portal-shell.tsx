'use client'
import React from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { AIOverlay } from '@/components/ai-overlay'
import type { PortalType } from '@/lib/portal-context'

// Ordered specific-before-general so derivePageName resolves the deepest match first.
const PATH_PAGE_NAMES: Record<string, string> = {
  '/dashboard':                 'Dashboard',
  '/marketplace/listings/new':  'New Listing',
  '/marketplace/financing':     'Financing',
  '/marketplace':               'Strike Place',
  '/deals/import':              'Finance an Existing Trade',
  '/deals':                     'My Deals',
  '/networks':                  'Networks',
  '/rooms':                     'Strike Rooms',
  '/passport':                  'My Passport',
  '/programs':                  'Programs',
  '/transactions':              'Transactions',
  '/kyb':                       'KYB Review',
  '/reporting':                 'Reporting',
  '/settings/agent':            'AI Agent Preferences',
  '/settings':                  'Settings',
  '/admin':                     'Administration',
  '/ai':                        'Strike AI',
}

function derivePageName(pathname: string): string {
  for (const [path, name] of Object.entries(PATH_PAGE_NAMES)) {
    if (pathname === path || pathname.startsWith(path + '/')) return name
  }
  return 'Dashboard'
}

export function PortalShell({
  children,
  portal,
  userName,
}: {
  children: React.ReactNode
  portal: PortalType
  userName?: string
}) {
  const pathname = usePathname()
  const page = derivePageName(pathname)
  const showOverlay = !pathname.startsWith('/ai')

  return (
    <div className="app-shell" data-page-name={page}>
      <Sidebar />
      <main className="main">
        {children}
      </main>
      {showOverlay && (
        <AIOverlay portal={portal === 'admin' ? 'bank' : portal} userName={userName} />
      )}
    </div>
  )
}
