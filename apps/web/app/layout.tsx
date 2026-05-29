import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Strike SCF',
  description: 'Supply Chain Finance Platform',
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="shortcut icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/favicon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* SVG icon sprite — referenced via <use href="#i-{name}" /> */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <symbol id="i-dashboard" viewBox="0 0 16 16"><path d="M2 2h5v6H2zM9 2h5v3H9zM9 7h5v7H9zM2 10h5v4H2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></symbol>
            <symbol id="i-programs" viewBox="0 0 16 16"><path d="M2 4h12v9H2z M2 7h12 M5 10h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></symbol>
            <symbol id="i-reports" viewBox="0 0 16 16"><path d="M3 13V5M7 13V3M11 13V8M3 13h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></symbol>
            <symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></symbol>
            <symbol id="i-bell" viewBox="0 0 16 16"><path d="M4 7a4 4 0 018 0v3l1 2H3l1-2V7zM6.5 13.5a1.5 1.5 0 003 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></symbol>
            <symbol id="i-bell-fill" viewBox="0 0 16 16"><path d="M4 7a4 4 0 018 0v3l1 2H3l1-2V7zM6.5 13.5a1.5 1.5 0 003 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></symbol>
            <symbol id="i-sun" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></symbol>
            <symbol id="i-moon" viewBox="0 0 16 16"><path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></symbol>
            <symbol id="i-warn" viewBox="0 0 16 16"><path d="M8 2l6.5 11h-13z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M8 6.5v3.5M8 12v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></symbol>
            <symbol id="i-chev-right" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></symbol>
            <symbol id="i-doc" viewBox="0 0 16 16"><path d="M4 2h6l2 2v10H4z M9 2v3h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></symbol>
            <symbol id="i-arrow-right" viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></symbol>
            <symbol id="i-back" viewBox="0 0 16 16"><path d="M13 8H3M7 4L3 8l4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></symbol>
            <symbol id="i-settings" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></symbol>
            <symbol id="i-check" viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></symbol>
            <symbol id="i-invoice" viewBox="0 0 16 16"><path d="M3 2h10v12l-2-1.2-2 1.2-2-1.2-2 1.2L3 13zM5.5 6h5M5.5 9h5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></symbol>
            <symbol id="i-refresh" viewBox="0 0 16 16"><path d="M13 4v3h-3M3 12V9h3M3.5 7a4.5 4.5 0 018-2M12.5 9a4.5 4.5 0 01-8 2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></symbol>
            <symbol id="i-box" viewBox="0 0 16 16"><path d="M2 5l6-3 6 3v6l-6 3-6-3zM2 5l6 3 6-3M8 8v6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></symbol>
            <symbol id="i-message" viewBox="0 0 16 16"><path d="M2 4h12v8H6l-3 2V4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></symbol>
            <symbol id="i-alert" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M8 5v3.5M8 11v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></symbol>
            <symbol id="i-info" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M8 7v4M8 5v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></symbol>
            <symbol id="i-upload" viewBox="0 0 20 20"><path d="M10 13V3M5 8l5-5 5 5M3 17h14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></symbol>
            <symbol id="i-error" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M8 5v3.5M8 11v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></symbol>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  )
}
