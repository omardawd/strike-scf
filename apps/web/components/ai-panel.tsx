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
}

interface AIPanelProps {
  isOpen: boolean
  onClose: () => void
  context: AIPanelContext
}

function buildSystemPrompt(ctx: AIPanelContext): string {
  return `You are Strike AI, an intelligent assistant embedded in a Supply Chain Finance platform.

Current user: ${ctx.userName}
Organization: ${ctx.orgName}
Portal: ${ctx.portal}
Current page: ${ctx.page}
${ctx.entityData ? `\nCurrent context data:\n${JSON.stringify(ctx.entityData, null, 2)}\n` : ''}
You help with:
- Analyzing transactions, offers, and counterparty risk
- Explaining SCF concepts and workflows
- Generating summaries and insights
- Drafting communications
- Answering questions about the platform

Be concise, professional, and data-aware. When discussing numbers, always format them as currency or percentages as appropriate. Never make up data — only reference what is in the context provided.`
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

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: buildSystemPrompt(context),
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await response.json()
      const assistantMessage: string = data.content?.[0]?.text ?? 'No response'
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: assistantMessage, timestamp: new Date() },
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
            placeholder="Ask anything..."
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
