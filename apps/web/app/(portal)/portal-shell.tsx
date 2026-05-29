'use client'
import React, { useState, useRef, useCallback, useEffect } from 'react'
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

  // Draggable position — stored as bottom/right offset from viewport
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 28, y: 28 })
  const dragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, bx: 0, by: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag on the button body, not propagated events
    dragging.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, bx: pos.x, by: pos.y }
    e.preventDefault()
  }, [pos])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const dx = e.clientX - dragStart.current.mx
      const dy = e.clientY - dragStart.current.my
      const newX = Math.max(8, dragStart.current.bx + dx)
      const newY = Math.max(8, Math.min(window.innerHeight - 60, dragStart.current.by + dy))
      setPos({ x: newX, y: newY })
    }
    function onUp() { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <>
      <style>{`
        @keyframes dot-float {
          0%, 100% { transform: translateY(0); opacity: 1; }
          50% { transform: translateY(-4px); opacity: 0.6; }
        }
        @keyframes strike-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.92); }
        }
        @keyframes orbit {
          from { transform: rotate(0deg) translateX(20px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(20px) rotate(-360deg); }
        }
        @keyframes ring-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
      <AIContext.Provider value={{ aiOpen, onAIToggle: () => setAiOpen(v => !v) }}>
        <div className="app-shell">
          <Sidebar />
          <main className="main">
            {children}
          </main>
          <AIPanel
            isOpen={aiOpen}
            onClose={() => setAiOpen(false)}
            context={{ portal, page, userName }}
          />

          {/* Strike AI draggable launcher */}
          <button
            ref={btnRef}
            onMouseDown={onMouseDown}
            onClick={() => { if (!dragging.current) setAiOpen(v => !v) }}
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              zIndex: 200,
              width: 52,
              height: 52,
              background: aiOpen ? 'var(--blue)' : 'var(--white)',
              border: `1px solid ${aiOpen ? 'var(--blue)' : 'var(--border)'}`,
              borderRadius: '50%',
              cursor: dragging.current ? 'grabbing' : 'grab',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s ease, box-shadow 0.15s ease',
              boxShadow: '0 2px 12px rgba(0,82,255,0.15)',
              userSelect: 'none',
            }}
            title="Strike AI"
          >
            {aiOpen ? (
              <span style={{ color: 'white', fontSize: 20, lineHeight: 1, fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>
                ×
              </span>
            ) : (
              <img
                src="/favicon.png"
                alt="Strike AI"
                draggable={false}
                style={{ width: 28, height: 28, objectFit: 'contain', pointerEvents: 'none' }}
              />
            )}
          </button>
        </div>
      </AIContext.Provider>
    </>
  )
}
