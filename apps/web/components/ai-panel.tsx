'use client'
import React, { useState, useRef, useEffect, createContext, useContext } from 'react'

interface AIState {
  aiOpen: boolean
  onAIToggle: () => void
}
export const AIContext = createContext<AIState>({ aiOpen: false, onAIToggle: () => {} })
export function useAI() { return useContext(AIContext) }

export interface AIPanelContext {
  portal: 'bank' | 'anchor' | 'supplier'
  page: string
  entityType?: 'transaction' | 'program' | 'kyb' | 'dashboard'
  entityData?: Record<string, unknown>
  userName?: string
  orgName?: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isDocument?: boolean
}

interface AIPanelProps {
  isOpen: boolean
  onClose: () => void
  context: AIPanelContext
}

function buildSystemPrompt(ctx: AIPanelContext): string {
  return `You are Strike AI, the intelligent co-pilot embedded in Strike SCF — a Supply Chain Finance and supply chain intelligence platform.

CRITICAL RULES:
1. ONLY reference data that is explicitly provided in the context below. Never invent transaction amounts, supplier names, risk scores, or any other platform data.
2. If data is not in the context, say "I don't have that information in the current view — try navigating to the relevant page."
3. When discussing risk, use the actual risk_tier and risk_flags from the context.
4. When discussing financials, use exact numbers from the context — do not round or estimate unless asked.
5. For document generation requests, generate a complete professional document using ONLY the data provided in the context.

Current user: ${ctx.userName ?? 'Unknown'}
Organization: ${ctx.orgName ?? 'Unknown'}
Portal: ${ctx.portal}
Current page: ${ctx.page}
${ctx.entityType ? `Entity type: ${ctx.entityType}` : ''}
${ctx.entityData
  ? `\nCurrent page data:\n${JSON.stringify(ctx.entityData, null, 2)}`
  : '\nNo entity data available for this page.'}

You can help with:
- Analyzing transactions, offers, and counterparty risk
- Explaining SCF concepts and workflows
- Answering questions about what you see on this page
- Generating formatted documents from the data above
- Summarizing analytics and reporting data
- Explaining tariff exposure and geopolitical risk

Always be concise. Use bullet points for lists. Format currency as $X,XXX. Format percentages as X.X%.`
}

function getQuickPrompts(ctx: AIPanelContext): string[] {
  if (ctx.entityType === 'transaction') return [
    'Summarize this transaction',
    'What is the risk profile here?',
    "Generate a transaction summary",
  ]
  if (ctx.entityType === 'kyb') return [
    'Summarize this KYB application',
    'What are the key risk factors?',
    'Generate a KYB review document',
  ]
  if (ctx.portal === 'bank') return [
    'What actions need my attention?',
    'Summarize the current view',
    'Highlight any risk concerns',
    'Generate a summary report',
  ]
  if (ctx.portal === 'anchor') return [
    'Which suppliers need attention?',
    'Summarize my active programs',
    'What invoices are pending?',
  ]
  return [
    'Summarize my transactions',
    'What is my financing rate?',
    'Explain early payment options',
  ]
}

export function AIPanel({ isOpen, onClose, context }: AIPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (isOpen) textareaRef.current?.focus()
  }, [isOpen])

  async function sendMessage(userMessage: string) {
    setLoading(true)
    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: userMessage, timestamp: new Date() },
    ]
    setMessages(newMessages)
    setInput('')

    const docKeywords = [
      'generate', 'create document', 'make a report',
      'bcbs', 'mas 610', 'eba finrep', 'finrep',
      'transaction summary', 'kyb summary',
      'invoice confirmation', 'anchor payment',
      'download', 'export document', 'create report',
    ]
    const isDocRequest = docKeywords.some(k => userMessage.toLowerCase().includes(k))

    const systemPrompt = buildSystemPrompt(context) + (isDocRequest
      ? '\n\nIMPORTANT: The user is requesting a document. Generate a complete, well-formatted document in Markdown format. Use proper headers (##), bold labels (**Label:**), tables where appropriate, and clear sections. Make it professional and ready to download. Include all relevant data from the context provided.'
      : '')

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'chat',
          system: systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: isDocRequest ? 4096 : 1024,
        }),
      })
      if (res.status === 429) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Daily AI limit reached. Resets at midnight UTC.',
          timestamp: new Date(),
        }])
        setLoading(false)
        return
      }
      const data = await res.json()
      const assistantMessage: string = data.content?.[0]?.text ?? 'No response'
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date(),
        isDocument: isDocRequest,
      }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }])
    }
    setLoading(false)
  }

  const quickPrompts = getQuickPrompts(context)

  return (
    <>
      <style>{`
        @keyframes ai-logo-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes ai-msg-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ai-quick-prompt:hover {
          border-color: var(--ink) !important;
          background: var(--white) !important;
        }
        .ai-send-btn:not(:disabled):hover {
          background: var(--blue) !important;
          border-color: var(--blue) !important;
          color: white !important;
        }
        .ai-clear-btn:hover { color: rgba(255,255,255,0.8) !important; }
      `}</style>

      <div style={{
        position: 'fixed',
        top: 56,
        right: 0,
        width: isOpen ? 420 : 0,
        height: 'calc(100vh - 56px)',
        background: 'var(--white)',
        borderLeft: '1px solid var(--border)',
        zIndex: 50,
        overflow: 'hidden',
        transition: 'width 0.25s ease',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          background: 'var(--ink)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'white', lineHeight: 1.2 }}>Strike AI</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.38)', marginTop: 1 }}>{context.page.toUpperCase()}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {messages.length > 0 && (
              <button
                className="ai-clear-btn"
                onClick={() => setMessages([])}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', padding: '2px 6px', transition: 'color 0.1s' }}
              >
                CLEAR
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 20, padding: '0 2px', lineHeight: 1, fontFamily: 'var(--font-mono)' }}
            >
              ×
            </button>
          </div>
        </div>

        {/* ── Messages ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Empty state */}
          {messages.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '36px 12px 24px', animation: 'ai-msg-in 0.3s ease' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                <img src="/favicon.png" alt="" draggable={false} style={{ width: 56, height: 56, objectFit: 'contain', animation: 'ai-logo-spin 4s linear infinite' }} />
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Strike AI</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--gray)', marginBottom: 28 }}>Supply chain intelligence co-pilot</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
                {quickPrompts.map((p, i) => (
                  <button
                    key={i}
                    className="ai-quick-prompt"
                    onClick={() => sendMessage(p)}
                    style={{
                      padding: '9px 14px',
                      background: 'var(--offwhite)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-body)',
                      fontSize: 12,
                      color: 'var(--ink)',
                      lineHeight: 1.4,
                      transition: 'border-color 0.12s, background 0.12s',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--gray)', marginRight: 8, letterSpacing: '0.06em' }}>{String(i + 1).padStart(2, '0')}</span>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 3, animation: 'ai-msg-in 0.2s ease' }}
            >
              {m.role === 'assistant' ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: '92%' }}>
                  <img src="/favicon.png" alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.65, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {m.content}
                  </div>
                </div>
              ) : (
                <div style={{ maxWidth: '80%', padding: '10px 14px', background: 'var(--ink)', color: 'white', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {m.content}
                </div>
              )}

              {m.role === 'assistant' && m.isDocument && (
                <button
                  onClick={() => {
                    const blob = new Blob([m.content], { type: 'text/plain' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `strike_document_${Date.now()}.md`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  style={{ marginLeft: 30, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'none', border: '1px solid var(--blue)', color: 'var(--blue)', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  ↓ Download document
                </button>
              )}

              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--gray-soft)', letterSpacing: '0.06em', paddingLeft: m.role === 'assistant' ? 30 : 0 }}>
                {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}

          {/* Loading */}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, animation: 'ai-msg-in 0.2s ease' }}>
              <img src="/favicon.png" alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0, marginTop: 2, animation: 'ai-logo-spin 0.9s linear infinite' }} />
              <div style={{ padding: '11px 16px', background: 'var(--offwhite)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--gray)', textTransform: 'uppercase' }}>Thinking</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input ── */}
        <div style={{ padding: '12px 16px 14px', borderTop: '1px solid var(--border)', background: 'var(--white)', flexShrink: 0 }}>
          <div style={{ border: '1px solid var(--border)', background: 'var(--white)', display: 'flex', flexDirection: 'column', transition: 'border-color 0.12s' }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (input.trim() && !loading) sendMessage(input.trim())
                }
              }}
              placeholder={
                context.entityType === 'transaction'
                  ? "Ask about this transaction or say 'generate summary'…"
                  : context.entityType === 'kyb'
                  ? "Ask about this KYB or say 'generate KYB summary'…"
                  : 'Ask anything about your ' + context.page.toLowerCase() + '…'
              }
              rows={2}
              style={{
                resize: 'none',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                border: 'none',
                padding: '10px 12px',
                outline: 'none',
                background: 'transparent',
                color: 'var(--ink)',
                width: '100%',
                boxSizing: 'border-box',
                lineHeight: 1.5,
              }}
            />
            <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--offwhite)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--gray)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                ↵ Send · Shift+↵ Newline
              </span>
              <button
                className="ai-send-btn"
                onClick={() => { if (input.trim() && !loading) sendMessage(input.trim()) }}
                disabled={!input.trim() || loading}
                style={{
                  padding: '4px 14px',
                  background: input.trim() && !loading ? 'var(--ink)' : 'transparent',
                  border: `1px solid ${input.trim() && !loading ? 'var(--ink)' : 'var(--border)'}`,
                  color: input.trim() && !loading ? 'white' : 'var(--gray)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: input.trim() && !loading ? 'pointer' : 'default',
                  transition: 'all 0.12s',
                }}
              >
                Send →
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
