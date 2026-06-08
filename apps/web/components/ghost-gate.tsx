'use client'

import { usePathname } from 'next/navigation'
import { useGhost } from '@/lib/use-ghost'
import { GhostLock } from '@/components/ghost-lock'

// ─────────────────────────────────────────────────────────────────────────────
// GhostGate — the ONE central feature gate for Tier-0 (ghost) orgs.
//
// Mounted once inside the portal layout, wrapping the page body but INSIDE the
// PortalShell, so ghost users keep the full shell + every nav item (TD.2) while
// actionable pages are swapped for a locked card.
//
// STRICT NO-OP for everyone who isn't a ghost: useGhost() returns isGhost=false
// for bank users, strike_admin, and any org that has activated its Passport, so
// this component renders {children} untouched for them. That is what keeps
// Track C's bank pages (and all non-ghost org pages) completely unaffected.
//
// Browse-only philosophy (TD.2): ghost orgs CAN read/browse — Dashboard, Strike
// Place (marketplace browse), Passport, Settings, Strike AI. Everything that
// takes an ACTION (deals, rooms, financing, programs, posting a listing, …) is
// locked. The marketplace LIST page is allowed here so listings stay visible;
// its action buttons are locked inside the page itself.
// ─────────────────────────────────────────────────────────────────────────────

// Path prefixes a ghost org may view. Order doesn't matter — startsWith match.
const GHOST_ALLOWED_PREFIXES = [
  '/dashboard',
  '/passport',
  '/settings',
  '/ai',
]

// The marketplace browse page is allowed, but its sub-routes that take an action
// (post a listing, financing request flow) are locked. Listed most-specific first.
const MARKETPLACE_LOCKED_PREFIXES = [
  '/marketplace/listings/new',
  '/marketplace/listings', // viewing a listing → Submit Offer lives there → lock
  '/marketplace/financing',
]

// Per-page sentence for the locked card. Falls back to a generic line.
const LOCK_SENTENCES: { prefix: string; sentence: string }[] = [
  { prefix: '/deals',                 sentence: 'Submit financing requests and manage your trade pipeline once your Passport is active.' },
  { prefix: '/rooms',                 sentence: 'Negotiate deals in real time with verified counterparties once your Passport is active.' },
  { prefix: '/programs',              sentence: 'Join supply-chain finance programs from banks once your Passport is active.' },
  { prefix: '/transactions',          sentence: 'Track financing transactions across the SCF engine once your Passport is active.' },
  { prefix: '/reporting',             sentence: 'Unlock analytics on your trade and financing activity once your Passport is active.' },
  { prefix: '/collateral',            sentence: 'Manage collateral requirements once your Passport is active.' },
  { prefix: '/marketplace/listings/new', sentence: 'Post products and PO requests on Strike Place once your Passport is active.' },
  { prefix: '/marketplace/listings',  sentence: 'Submit offers on Strike Place listings once your Passport is active.' },
  { prefix: '/marketplace/financing', sentence: 'Request financing from competing banks once your Passport is active.' },
]

function isAllowed(pathname: string): boolean {
  // Marketplace: browse list is allowed; action sub-routes are locked.
  if (MARKETPLACE_LOCKED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return false
  }
  if (pathname === '/marketplace' || pathname.startsWith('/marketplace?')) return true

  return GHOST_ALLOWED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
}

function sentenceFor(pathname: string): string {
  const match = LOCK_SENTENCES.find(s => pathname === s.prefix || pathname.startsWith(s.prefix + '/'))
  return match?.sentence ?? 'Activate your Passport to start transacting on Strike.'
}

export function GhostGate({ children }: { children: React.ReactNode }) {
  const { isGhost } = useGhost()
  const pathname = usePathname()

  // Non-ghost (bank, admin, activated org): render untouched. Strict no-op.
  if (!isGhost) return <>{children}</>

  if (isAllowed(pathname)) return <>{children}</>

  return <GhostLock sentence={sentenceFor(pathname)} />
}
