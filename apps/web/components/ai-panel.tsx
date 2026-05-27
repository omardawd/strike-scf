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

export function AIPanel({ isOpen, onClose, context }: AIPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

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
      'download', 'export document', 'create report'
    ]
    const isDocRequest = docKeywords.some(k =>
      userMessage.toLowerCase().includes(k))

    const systemPrompt = buildSystemPrompt(context) + (isDocRequest
      ? `\n\nIMPORTANT: The user is requesting a document. Generate a complete, well-formatted document in Markdown format. Use proper headers (##), bold labels (**Label:**), tables where appropriate, and clear sections. Make it professional and ready to download. Include all relevant data from the context provided.`
      : '')

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feature: 'chat',
          system: systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: isDocRequest ? 4096 : 1024,
        }),
      })
      if (res.status === 429) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: 'Daily AI limit reached. Resets at midnight UTC.',
            timestamp: new Date(),
          },
        ])
        setLoading(false)
        return
      }
      const data = await res.json()
      const assistantMessage: string = data.content?.[0]?.text ?? 'No response'
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: assistantMessage, timestamp: new Date(), isDocument: isDocRequest },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: new Date(),
        },
      ])
    }
    setLoading(false)
  }

  return (
    <>
      <style>{`
        @keyframes dot-pulse {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        @keyframes dot-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          top: 56,
          right: 0,
          width: isOpen ? 380 : 0,
          height: 'calc(100vh - 56px)',
          background: 'var(--white)',
          borderLeft: '1px solid var(--border)',
          zIndex: 50,
          overflow: 'hidden',
          transition: 'width 0.25s ease',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="page-badge-dot" />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--blue)',
                whiteSpace: 'nowrap',
              }}
            >
              Strike AI
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--gray)',
              fontSize: 18,
              padding: 4,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                color: 'var(--gray)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.1em',
                textAlign: 'center',
                marginTop: 40,
                whiteSpace: 'nowrap',
              }}
            >
              Ask me anything about your{' '}
              {context.page.toLowerCase()}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                gap: 4,
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  background: m.role === 'user' ? 'var(--ink)' : 'var(--offwhite)',
                  color: m.role === 'user' ? 'var(--white)' : 'var(--ink)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {m.content}
              </div>
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
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 6,
                    padding: '5px 12px',
                    background: 'none',
                    border: '1px solid var(--blue)',
                    color: 'var(--blue)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}>
                  ↓ Download document
                </button>
              )}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--gray-soft)',
                  letterSpacing: '0.08em',
                }}
              >
                {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
          {loading && (
            <div
              style={{
                display: 'flex',
                gap: 4,
                padding: '10px 14px',
                background: 'var(--offwhite)',
                border: '1px solid var(--border)',
                width: 'fit-content',
              }}
            >
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  style={{
                    width: 4,
                    height: 4,
                    background: 'var(--gray)',
                    borderRadius: '50%',
                    animation: `dot-pulse 1.4s ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (input.trim()) sendMessage(input.trim())
              }
            }}
            placeholder={
              context.entityType === 'transaction'
                ? "Ask anything or say 'generate transaction summary'..."
                : context.entityType === 'kyb'
                ? "Ask anything or say 'generate KYB summary'..."
                : "Ask anything..."
            }
            rows={2}
            style={{
              flex: 1,
              resize: 'none',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              border: '1px solid var(--border)',
              padding: '8px 12px',
              outline: 'none',
              background: 'var(--white)',
              color: 'var(--ink)',
              borderRadius: 0,
            }}
          />
          <button
            onClick={() => { if (input.trim()) sendMessage(input.trim()) }}
            disabled={!input.trim() || loading}
            style={{
              padding: '0 14px',
              background: 'var(--blue)',
              border: 'none',
              color: 'var(--white)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.1em',
              cursor: 'pointer',
              opacity: !input.trim() || loading ? 0.5 : 1,
            }}
          >
            →
          </button>
        </div>
      </div>
    </>
  )
}
