import Image from 'next/image'
import { TOUR_NAV } from './tour-data'

// Static visual clone of components/sidebar.tsx — same CSS classes
// (.sidebar/.nav-item/.sidebar-footer/.avatar, all portal-agnostic, defined
// in app/globals.css) and the same icon paths, but driven by tour scene
// navigation instead of real routes/auth. Intentionally not the real
// Sidebar component: its nav links point at auth-gated routes, which would
// bounce an anonymous tour visitor to /login mid-tour.

type NavIconName = 'ai' | 'dashboard' | 'marketplace' | 'deals' | 'financing' | 'networks' | 'rooms' | 'passport' | 'analytics'

const NAV_ICONS: Record<NavIconName, React.ReactNode> = {
  ai: (
    <>
      <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
      <path d="M16 4.5v2M15 5.5h2" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="6.5" height="6.5" rx="1.5" />
      <rect x="10.5" y="3" width="6.5" height="6.5" rx="1.5" />
      <rect x="3" y="10.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  marketplace: (
    <>
      <path d="M3 8l7-4 7 4" />
      <path d="M4 8v8M8 8v8M12 8v8M16 8v8" />
      <path d="M2.5 16.5h15" />
    </>
  ),
  deals: (
    <>
      <path d="M9.5 7.5l-2-1.5a2 2 0 0 0-2.4.2L2.5 8.5" />
      <path d="M10.5 7.5l2-1.5a2 2 0 0 1 2.4.2l2.6 2.3" />
      <path d="M2.5 8.5v4l2.5 2 2 1.6a1.3 1.3 0 0 0 2-.3" />
      <path d="M17.5 8.5v4l-2.8 2.2-2.2-1.8-2-1.6" />
      <path d="M10 8.2l1.8 1.5a1.2 1.2 0 0 1-1.6 1.8L8.5 10" />
    </>
  ),
  financing: (
    <>
      <path d="M16.5 5.5V9h-3.5" />
      <path d="M3.5 14.5V11h3.5" />
      <path d="M4.2 9a6 6 0 0 1 10.5-2.7L16.5 8" />
      <path d="M15.8 11a6 6 0 0 1-10.5 2.7L3.5 12" />
    </>
  ),
  networks: (
    <>
      <circle cx="10" cy="4" r="2" />
      <circle cx="3" cy="15" r="2" />
      <circle cx="17" cy="15" r="2" />
      <line x1="10" y1="6" x2="3.8" y2="13.2" strokeLinecap="round" />
      <line x1="10" y1="6" x2="16.2" y2="13.2" strokeLinecap="round" />
      <line x1="5" y1="15" x2="15" y2="15" strokeLinecap="round" />
    </>
  ),
  rooms: (
    <>
      <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 12 6.5V10a1.5 1.5 0 0 1-1.5 1.5H7L4.5 13.5V11A1.5 1.5 0 0 1 3 9.5z" />
      <path d="M9 8.5h5A1.5 1.5 0 0 1 15.5 10v2A1.5 1.5 0 0 1 14 13.5h-.5l2 2.5v-2.5" />
    </>
  ),
  passport: (
    <>
      <path d="M10 2.5l6 2.2v4.6c0 3.6-2.5 6.4-6 8.2-3.5-1.8-6-4.6-6-8.2V4.7z" />
      <path d="M7.3 9.8l2 2 3.4-3.6" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 17V3" />
      <path d="M3 17h14" />
      <rect x="6" y="11" width="2.6" height="4.5" rx="0.6" />
      <rect x="10" y="8" width="2.6" height="7.5" rx="0.6" />
      <rect x="14" y="5" width="2.6" height="10.5" rx="0.6" />
      <path d="M6 9l4-3 4-2" />
    </>
  ),
}

function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="nav-icon" aria-hidden="true">
      {NAV_ICONS[name]}
    </svg>
  )
}

export default function TourSidebar({
  activeSceneId,
  onNavigate,
}: {
  activeSceneId: string
  onNavigate: (sceneId: string) => void
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Image
          src="/logo.png"
          alt="Strike SCF"
          width={132}
          height={42}
          style={{ objectFit: 'contain', objectPosition: 'left center', maxWidth: '100%', height: 'auto' }}
          priority
        />
      </div>
      <nav className="nav-section" style={{ marginTop: 4 }}>
        {/* A few nav items share a target scene (no dedicated scene exists for
            Passport/Analytics in this simplified tour — see TOUR_NAV), so
            matching on sceneId alone would highlight several items at once.
            Only the first item in nav order that targets the active scene
            is ever shown active. */}
        {TOUR_NAV.map((item, i) => {
          const isActive = activeSceneId === item.sceneId && TOUR_NAV.findIndex((n) => n.sceneId === item.sceneId) === i
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onNavigate(item.sceneId)}
              className={`nav-item${isActive ? ' active' : ''}`}
              style={{ transition: 'background 150ms, color 150ms' }}
            >
              <NavIcon name={item.icon as NavIconName} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div style={{ marginTop: 'auto' }}>
        <div className="sidebar-footer">
          <div className="avatar">WM</div>
          <div className="user-meta">
            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>Walmart</span>
            <span style={{ fontSize: 11, color: 'var(--gray-soft, var(--gray))' }}>Anchor · Tour</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
