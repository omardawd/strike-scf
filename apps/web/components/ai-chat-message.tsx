'use client'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { STRIKE_BLOCK_RE, StrikeBlockFromJson } from '@/components/ai-blocks'

// Shared assistant-message rendering — used by both the Strike AI page and
// Dashboard 2's inline chat so replies (markdown, [[STRIKE_BLOCK:...]] directives,
// [LISTING_CARD:uuid] tokens) render identically wherever a conversation is shown.

const LISTING_CARD_RE = /\[LISTING_CARD:([0-9a-f-]{36})\]/gi

function ListingCard({ id }: { id: string }) {
  return (
    <a
      href={`/marketplace/listings/${id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        margin: '8px 0', padding: '12px 16px',
        background: 'var(--white)', border: '1px solid var(--border)',
        borderRadius: 12, textDecoration: 'none', color: 'var(--ink)',
        fontSize: 13, fontWeight: 600, boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: 'var(--blue-light)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="var(--blue)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="14" height="14" rx="3" />
          <path d="M7 10h6M7 13h4" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>View listing on Strike Place</div>
        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>Click to open your new listing →</div>
      </div>
    </a>
  )
}

const MD_COMPONENTS = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h1: ({ children }: any) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '14px 0 6px' }}>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h2: ({ children }: any) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '12px 0 5px' }}>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h3: ({ children }: any) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: '10px 0 4px' }}>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: ({ children }: any) => <div style={{ margin: '4px 0', lineHeight: 1.65 }}>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strong: ({ children }: any) => <strong style={{ fontWeight: 700, color: 'var(--ink)' }}>{children}</strong>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  em: ({ children }: any) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  hr: () => <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0' }} />,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ul: ({ children }: any) => <ul style={{ paddingLeft: 18, margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</ul>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ol: ({ children }: any) => <ol style={{ paddingLeft: 18, margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</ol>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  li: ({ children }: any) => <li style={{ lineHeight: 1.6, color: 'var(--ink)' }}>{children}</li>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: ({ children }: any) => (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>{children}</table>
    </div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thead: ({ children }: any) => <thead style={{ background: 'var(--offwhite)' }}>{children}</thead>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  th: ({ children }: any) => <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{children}</th>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  td: ({ children }: any) => <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{children}</td>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: ({ children }: any) => <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--offwhite)', padding: '1px 5px', borderRadius: 4 }}>{children}</code>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blockquote: ({ children }: any) => <div style={{ borderLeft: '3px solid var(--border-strong)', paddingLeft: 10, margin: '6px 0', color: 'var(--gray)' }}>{children}</div>,
}

// Splits markdown text on [[STRIKE_BLOCK:{...}]] directives, rendering each
// as a real component and everything else through ReactMarkdown.
export function renderMarkdownWithBlocks(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  STRIKE_BLOCK_RE.lastIndex = 0
  while ((m = STRIKE_BLOCK_RE.exec(text)) !== null) {
    const before = text.slice(last, m.index).trim()
    if (before) {
      out.push(
        <ReactMarkdown key={`${keyPrefix}-md-${last}`} remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {before}
        </ReactMarkdown>
      )
    }
    out.push(<StrikeBlockFromJson key={`${keyPrefix}-blk-${m.index}`} keyProp={`${keyPrefix}-blk-${m.index}`} raw={m[1]!} />)
    last = m.index + m[0].length
  }
  const remainder = text.slice(last).trim()
  if (remainder) {
    out.push(
      <ReactMarkdown key={`${keyPrefix}-md-${last}`} remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {remainder}
      </ReactMarkdown>
    )
  }
  return out
}

/** Renders one assistant message's full content: [LISTING_CARD:uuid] tokens, [[STRIKE_BLOCK:...]] directives, and markdown prose. */
export function renderAssistantContent(content: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  LISTING_CARD_RE.lastIndex = 0
  while ((match = LISTING_CARD_RE.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index).trim()
    if (before) parts.push(...renderMarkdownWithBlocks(before, `seg-${lastIndex}`))
    const listingId = match[1]!
    parts.push(<ListingCard key={listingId} id={listingId} />)
    lastIndex = match.index + match[0].length
  }
  const remainder = content.slice(lastIndex).trim()
  if (remainder) parts.push(...renderMarkdownWithBlocks(remainder, `seg-${lastIndex}`))
  return <>{parts}</>
}
