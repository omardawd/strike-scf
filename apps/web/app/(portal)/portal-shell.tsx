'use client'
import React, { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { AIPanel, AIContext } from '@/components/ai-panel'
import type { PortalType } from '@/lib/portal-context'

const PATH_PAGE_NAMES: Record<string, string> = {
  '/dashboard':        'Dashboard',
  '/programs':         'Programs',
  '/transactions':     'Transactions',
  '/transactions/new': 'New Transaction',
  '/reporting':        'Reporting',
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
  const [aiOpen, setAiOpen] = useState(false)
  const pathname = usePathname()
  const page = derivePageName(pathname)

  return (
    <AIContext.Provider value={{ aiOpen, onAIToggle: () => setAiOpen(v => !v) }}>
      <div className="app-shell">
        <Sidebar />
        <main
          className="main"
          style={{
            marginRight: aiOpen ? 380 : 0,
            transition: 'margin-right 0.25s ease',
          }}
        >
          {children}
        </main>
        <AIPanel
          isOpen={aiOpen}
          onClose={() => setAiOpen(false)}
          context={{
            portal,
            page,
            userName,
          }}
        />

        {/* Strike AI floating button */}
        <button
          onClick={() => setAiOpen(v => !v)}
          style={{
            position: 'fixed',
            bottom: 28,
            right: aiOpen ? 408 : 28,
            zIndex: 200,
            width: 52,
            height: 52,
            background: aiOpen ? 'var(--blue)' : 'var(--ink)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 3,
            transition: 'right 0.25s ease, background 0.15s ease, transform 0.15s ease',
            boxShadow: aiOpen
              ? '0 4px 20px rgba(0,82,255,0.4)'
              : '0 4px 16px rgba(0,0,0,0.2)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-2px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)'
          }}
          title="Strike AI"
        >
          {aiOpen ? (
            <span style={{
              color: 'white',
              fontSize: 18,
              fontFamily: 'var(--font-mono)',
              lineHeight: 1,
            }}>×</span>
          ) : (
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: 'white',
                  animation: `dot-float 1.8s ${i * 0.2}s ease-in-out infinite`,
                }} />
              ))}
            </div>
          )}
        </button>

        {/* Tooltip label */}
        {!aiOpen && (
          <div
            id="strike-ai-tooltip"
            style={{
              position: 'fixed',
              bottom: 40,
              right: 88,
              zIndex: 199,
              background: 'var(--ink)',
              color: 'white',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              padding: '6px 12px',
              pointerEvents: 'none',
              opacity: 0,
              transition: 'opacity 0.15s',
            }}
          >
            Strike AI
          </div>
        )}
      </div>
    </AIContext.Provider>
  )
}
