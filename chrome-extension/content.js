// Strike AI ERP Widget — content script.
// Injected into every page. Renders a floating pill; expands to a full chat sidebar.

;(function () {
  'use strict'
  if (document.getElementById('strike-ai-root')) return

  // ─── ERP Detection ────────────────────────────────────────────────────────

  function detectErp() {
    const host = location.hostname
    if (typeof window.frappe !== 'undefined' || host.endsWith('.frappe.cloud')) return 'ERPNext'
    if (typeof window.__owl__ !== 'undefined' || typeof window.odoo !== 'undefined' || host.endsWith('.odoo.com')) return 'Odoo'
    if (host.includes('netsuite.com')) return 'NetSuite'
    if (typeof window.sap !== 'undefined' || host.includes('hana.ondemand.com') || host.includes('mysap.com')) return 'SAP'
    if (host.includes('dynamics.com')) return 'Dynamics 365'
    if (host.includes('intuit.com')) return 'QuickBooks'
    if (host.includes('xero.com')) return 'Xero'
    if (host.includes('sage.com') || host.includes('sageone.com')) return 'Sage'
    return null
  }

  // ─── Context Extraction ──────────────────────────────────────────────────

  function extractErpContext(erpType) {
    const parts = []
    const h1 = document.querySelector('h1, h2, [class*="title"], [class*="heading"]')
    const pageTitle = document.title.replace(' – ERPNext', '').replace(' | ', ' — ')
    parts.push(`Page: ${h1 ? h1.textContent.trim().slice(0, 80) : pageTitle}`)

    if (erpType === 'ERPNext' && typeof window.frappe !== 'undefined') {
      try {
        const doc = window.frappe.get_doc && window.frappe.get_doc()
        if (doc) {
          ;[['DocType', doc.doctype], ['Name', doc.name], ['Status', doc.status ?? doc.docstatus],
            ['Company', doc.company], ['Date', doc.posting_date ?? doc.transaction_date],
            ['Total', doc.grand_total ?? doc.total], ['Currency', doc.currency],
            ['Party', doc.supplier ?? doc.customer ?? doc.party]
          ].forEach(([k, v]) => { if (v != null) parts.push(`${k}: ${v}`) })
          return buildContext(erpType, parts)
        }
      } catch { /* fall through */ }
    }

    if (erpType === 'Odoo') {
      try {
        const widgets = document.querySelectorAll('.o_field_widget[name]')
        if (widgets.length) {
          widgets.forEach((el) => {
            const name = el.getAttribute('name')
            const val = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 100)
            if (name && val) parts.push(`${name}: ${val}`)
          })
          return buildContext(erpType, parts)
        }
      } catch { /* fall through */ }
    }

    // Generic: form labels + values
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.type === 'hidden' || el.type === 'password') return
      const val = (el.value || el.textContent || '').trim()
      if (!val || val.length > 200) return
      let label = ''
      if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) label = l.textContent.trim() }
      if (!label) { const prev = el.previousElementSibling; if (prev?.tagName === 'LABEL') label = prev.textContent.trim() }
      if (!label) { const p = el.closest('[class*="field"],[class*="form-group"],[class*="row"]'); if (p) { const l = p.querySelector('label,[class*="label"]'); if (l) label = l.textContent.trim() } }
      if (label && label.length < 60) parts.push(`${label}: ${val}`)
    })

    const amounts = (document.body.innerText ?? '').match(/[\$£€¥][\d,]+\.?\d*/g) ?? []
    const uniqueAmts = [...new Set(amounts)].slice(0, 5)
    if (uniqueAmts.length) parts.push(`Amounts: ${uniqueAmts.join(', ')}`)

    const table = document.querySelector('table')
    if (table) {
      const rows = [...table.querySelectorAll('tr')].slice(0, 4)
      if (rows.length > 1) {
        const hdrs = [...rows[0].querySelectorAll('th,td')].slice(0, 8).map(c => c.textContent.trim())
        const rowData = rows.slice(1).map(r => [...r.querySelectorAll('td')].slice(0, 8).map(c => c.textContent.trim()).join(' | '))
        if (hdrs.some(Boolean)) {
          parts.push(`Table: ${hdrs.filter(Boolean).join(' | ')}`)
          rowData.forEach((r, i) => { if (r.trim()) parts.push(`Row ${i + 1}: ${r}`) })
        }
      }
    }

    return buildContext(erpType, parts)
  }

  function buildContext(erpType, parts) {
    return (erpType ? `[ERP: ${erpType}] ` : '[Page] ') + parts.filter(Boolean).join('. ')
  }

  // ─── State ───────────────────────────────────────────────────────────────

  let isOpen   = false
  let loading  = false
  let config   = null
  let history  = []
  let messages = []
  let erpType  = detectErp()
  let erpCtx   = ''

  // ─── Styles ──────────────────────────────────────────────────────────────

  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

    #strike-ai-root * { box-sizing: border-box; margin: 0; padding: 0; }

    #strike-ai-root {
      position: fixed;
      bottom: 28px;
      right: 28px;
      z-index: 2147483647;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* ── Pill ── */
    #strike-pill {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 11px 20px 11px 14px;
      background: linear-gradient(135deg, #1428CC 0%, #7C3AED 100%);
      color: white;
      border-radius: 999px;
      cursor: pointer;
      font-size: 13.5px;
      font-weight: 700;
      letter-spacing: -0.01em;
      box-shadow: 0 4px 24px rgba(20,40,204,.32), 0 1px 4px rgba(0,0,0,.12);
      user-select: none;
      transition: box-shadow .18s, transform .18s;
    }
    #strike-pill:hover {
      box-shadow: 0 6px 32px rgba(20,40,204,.42), 0 2px 8px rgba(0,0,0,.14);
      transform: translateY(-1px);
    }
    #strike-pill.hidden { display: none; }

    .strike-pill-icon {
      width: 28px; height: 28px;
      background: rgba(255,255,255,.18);
      border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
    }
    .strike-pill-icon svg { width: 16px; height: 16px; }

    /* ── Sidebar shell ── */
    #strike-sidebar {
      position: fixed;
      top: 0; right: 0;
      width: 420px;
      height: 100vh;
      background: #F5F4F0;
      display: flex;
      flex-direction: column;
      box-shadow: -2px 0 48px rgba(0,0,0,.16);
      border-left: 1px solid rgba(0,0,0,.07);
      transform: translateX(100%);
      transition: transform .28s cubic-bezier(.4,0,.2,1);
      overflow: hidden;
    }
    #strike-sidebar.open { transform: translateX(0); }

    /* ── Header ── */
    .sk-header {
      background: linear-gradient(135deg, #1428CC 0%, #7C3AED 100%);
      padding: 18px 20px 16px;
      color: white;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
      position: relative;
    }
    .sk-header::after {
      content: '';
      position: absolute;
      inset: 0;
      background: url("data:image/svg+xml,%3Csvg width='200' height='80' viewBox='0 0 200 80' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='160' cy='20' r='60' fill='rgba(255,255,255,.04)'/%3E%3Ccircle cx='20' cy='60' r='40' fill='rgba(255,255,255,.03)'/%3E%3C/svg%3E") no-repeat right top;
      pointer-events: none;
    }
    .sk-logo {
      width: 36px; height: 36px;
      background: rgba(255,255,255,.2);
      border-radius: 11px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      position: relative; z-index: 1;
    }
    .sk-logo svg { width: 20px; height: 20px; }
    .sk-header-text { flex: 1; position: relative; z-index: 1; }
    .sk-header-text h2 { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
    .sk-header-text p { font-size: 12px; opacity: .72; margin-top: 2px; font-weight: 500; }
    .sk-close {
      width: 32px; height: 32px;
      background: rgba(255,255,255,.15);
      border: none; border-radius: 8px;
      color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .14s;
      position: relative; z-index: 1;
      flex-shrink: 0;
    }
    .sk-close:hover { background: rgba(255,255,255,.28); }
    .sk-close svg { width: 14px; height: 14px; }

    /* ── Context strip ── */
    .sk-ctx {
      background: white;
      border-bottom: 1px solid rgba(0,0,0,.06);
      padding: 10px 18px;
      font-size: 11.5px;
      color: #6B7280;
      line-height: 1.45;
      flex-shrink: 0;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .sk-ctx-dot {
      width: 6px; height: 6px;
      background: #10B981;
      border-radius: 50%;
      margin-top: 3px;
      flex-shrink: 0;
    }
    .sk-ctx-text { flex: 1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .sk-ctx strong { color: #1428CC; font-weight: 600; }

    /* ── Messages area ── */
    .sk-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px 8px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }
    .sk-messages::-webkit-scrollbar { width: 4px; }
    .sk-messages::-webkit-scrollbar-track { background: transparent; }
    .sk-messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,.12); border-radius: 99px; }

    /* ── Empty state ── */
    .sk-empty {
      flex: 1;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 32px 24px;
      text-align: center;
      gap: 10px;
    }
    .sk-empty-orb {
      width: 64px; height: 64px;
      background: linear-gradient(135deg, #EEF0FF, #F3E8FF);
      border-radius: 20px;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 4px;
    }
    .sk-empty-orb svg { width: 32px; height: 32px; }
    .sk-empty h3 { font-size: 15px; font-weight: 700; color: #0D0D0D; letter-spacing: -0.02em; }
    .sk-empty p { font-size: 13px; color: #6B7280; line-height: 1.55; max-width: 260px; }

    /* ── Chips ── */
    .sk-chips {
      display: flex; flex-wrap: wrap; gap: 7px;
      padding: 4px 16px 10px;
      flex-shrink: 0;
    }
    .sk-chip {
      padding: 7px 14px;
      background: white;
      border: 1.5px solid rgba(20,40,204,.15);
      border-radius: 999px;
      font-size: 12px; font-weight: 600;
      color: #1428CC;
      cursor: pointer;
      transition: background .12s, border-color .12s;
      line-height: 1;
      white-space: nowrap;
    }
    .sk-chip:hover { background: #EEF0FF; border-color: rgba(20,40,204,.3); }

    /* ── Message bubbles ── */
    .sk-msg-wrap { display: flex; flex-direction: column; gap: 2px; }
    .sk-msg-wrap.user { align-items: flex-end; }
    .sk-msg-wrap.assistant { align-items: flex-start; }

    .sk-avatar {
      width: 26px; height: 26px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700;
      flex-shrink: 0;
      margin-bottom: 2px;
    }
    .sk-avatar.assistant-av {
      background: linear-gradient(135deg, #1428CC, #7C3AED);
      color: white;
    }

    .sk-bubble {
      max-width: 84%;
      padding: 11px 15px;
      border-radius: 18px;
      font-size: 13.5px;
      line-height: 1.6;
      word-break: break-word;
    }
    .sk-bubble.user {
      background: linear-gradient(135deg, #1428CC 0%, #7C3AED 100%);
      color: white;
      border-bottom-right-radius: 5px;
    }
    .sk-bubble.assistant {
      background: white;
      color: #0D0D0D;
      border-bottom-left-radius: 5px;
      box-shadow: 0 1px 6px rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.04);
    }
    .sk-bubble.assistant p { margin-bottom: 6px; }
    .sk-bubble.assistant p:last-child { margin-bottom: 0; }
    .sk-bubble.assistant strong { font-weight: 700; }
    .sk-bubble.assistant em { font-style: italic; }
    .sk-bubble.assistant code {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 12px;
      background: #F5F4F0;
      padding: 1px 5px;
      border-radius: 4px;
    }
    .sk-bubble.assistant ul, .sk-bubble.assistant ol { padding-left: 18px; margin: 4px 0; }
    .sk-bubble.assistant li { margin-bottom: 3px; }
    .sk-ts {
      font-size: 10.5px;
      color: #9CA3AF;
      margin: 0 4px;
      font-weight: 500;
    }

    /* ── Typing indicator ── */
    .sk-typing-wrap { display: flex; align-items: flex-start; gap: 8px; }
    .sk-typing {
      background: white;
      border-radius: 18px;
      border-bottom-left-radius: 5px;
      padding: 13px 17px;
      display: flex; gap: 5px; align-items: center;
      box-shadow: 0 1px 6px rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.04);
    }
    .sk-dot {
      width: 7px; height: 7px;
      background: #CBD5E1;
      border-radius: 50%;
      animation: skPulse 1.4s ease-in-out infinite;
    }
    .sk-dot:nth-child(2) { animation-delay: .2s; }
    .sk-dot:nth-child(3) { animation-delay: .4s; }
    @keyframes skPulse {
      0%, 60%, 100% { transform: translateY(0); opacity: .6; }
      30% { transform: translateY(-5px); opacity: 1; }
    }

    /* ── Input area ── */
    .sk-input-wrap {
      padding: 12px 16px 16px;
      background: white;
      border-top: 1px solid rgba(0,0,0,.06);
      flex-shrink: 0;
    }
    .sk-input-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      background: #F5F4F0;
      border: 1.5px solid rgba(0,0,0,.09);
      border-radius: 16px;
      padding: 8px 8px 8px 14px;
      transition: border-color .15s, box-shadow .15s;
    }
    .sk-input-row:focus-within {
      border-color: #1428CC;
      box-shadow: 0 0 0 3px rgba(20,40,204,.08);
      background: white;
    }
    .sk-textarea {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 13.5px;
      font-family: inherit;
      resize: none;
      outline: none;
      max-height: 100px;
      color: #0D0D0D;
      line-height: 1.5;
    }
    .sk-textarea::placeholder { color: #9CA3AF; }
    .sk-send {
      width: 34px; height: 34px; flex-shrink: 0;
      background: linear-gradient(135deg, #1428CC 0%, #7C3AED 100%);
      border: none; border-radius: 10px;
      color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: opacity .15s, transform .12s;
    }
    .sk-send:hover:not(:disabled) { transform: scale(1.06); }
    .sk-send:disabled { opacity: .38; cursor: default; }
    .sk-send svg { width: 16px; height: 16px; }

    /* ── Error toast ── */
    .sk-err {
      margin: 0 16px 10px;
      padding: 10px 14px;
      font-size: 12.5px;
      color: #EF4444;
      background: #FEE2E2;
      border: 1px solid rgba(239,68,68,.15);
      border-radius: 10px;
      display: none;
      flex-shrink: 0;
    }

    /* ── Setup screen ── */
    .sk-setup {
      flex: 1;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 36px 28px;
      text-align: center;
      gap: 12px;
    }
    .sk-setup-orb {
      width: 72px; height: 72px;
      background: linear-gradient(135deg, #EEF0FF, #F3E8FF);
      border-radius: 22px;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 4px;
    }
    .sk-setup h3 { font-size: 17px; font-weight: 700; color: #0D0D0D; letter-spacing: -0.02em; }
    .sk-setup p { font-size: 13px; color: #6B7280; line-height: 1.6; max-width: 280px; }
    .sk-setup-btn {
      margin-top: 8px;
      padding: 10px 24px;
      background: linear-gradient(135deg, #1428CC, #7C3AED);
      color: white;
      border: none; border-radius: 999px;
      font-size: 13.5px; font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: opacity .14s;
    }
    .sk-setup-btn:hover { opacity: .88; }
  `

  // ─── SVG Icons ──────────────────────────────────────────────────────────

  const ICON_LIGHTNING = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z" fill="currentColor"/></svg>`
  const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
  const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

  // ─── Simple markdown renderer ───────────────────────────────────────────

  function renderMarkdown(text) {
    let html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')
    // Simple bullet list
    html = html.replace(/((?:•|-|\*)\s+.+(?:<br>|$))+/g, (match) => {
      const items = match.split(/<br>/).filter(s => /^(•|-|\*)\s+/.test(s.trim()))
      if (!items.length) return match
      return '<ul>' + items.map(i => `<li>${i.replace(/^(•|-|\*)\s+/, '')}</li>`).join('') + '</ul>'
    })
    return html
  }

  // ─── DOM Building ─────────────────────────────────────────────────────────

  function buildUI() {
    erpCtx = extractErpContext(erpType)

    const style = document.createElement('style')
    style.textContent = STYLES
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.id = 'strike-ai-root'
    document.body.appendChild(root)

    // Pill
    const pill = document.createElement('div')
    pill.id = 'strike-pill'
    pill.innerHTML = `<div class="strike-pill-icon">${ICON_LIGHTNING}</div><span>Strike AI</span>`
    pill.addEventListener('click', openSidebar)
    root.appendChild(pill)

    // Sidebar
    const sidebar = document.createElement('div')
    sidebar.id = 'strike-sidebar'
    root.appendChild(sidebar)

    renderSidebar()
  }

  function renderSidebar() {
    const sidebar = document.getElementById('strike-sidebar')
    if (!sidebar) return

    const erpLabel = erpType ? `${erpType} connected` : 'ERP assistant'

    sidebar.innerHTML = `
      <div class="sk-header">
        <div class="sk-logo">${ICON_LIGHTNING}</div>
        <div class="sk-header-text">
          <h2>Strike AI</h2>
          <p>${erpLabel}</p>
        </div>
        <button class="sk-close" id="sk-close-btn">${ICON_CLOSE}</button>
      </div>
      ${erpCtx ? `
        <div class="sk-ctx">
          <div class="sk-ctx-dot"></div>
          <div class="sk-ctx-text"><strong>Page captured</strong> · ${erpCtx.slice(0, 160)}${erpCtx.length > 160 ? '…' : ''}</div>
        </div>
      ` : ''}
      <div id="sk-body" style="display:flex;flex-direction:column;flex:1;overflow:hidden;"></div>
    `

    sidebar.querySelector('#sk-close-btn').addEventListener('click', closeSidebar)
    renderBody()
  }

  function renderBody() {
    const body = document.getElementById('sk-body')
    if (!body) return

    if (!config?.token || !config?.strikeUrl) {
      body.innerHTML = `
        <div class="sk-setup">
          <div class="sk-setup-orb">${ICON_LIGHTNING}</div>
          <h3>Connect Strike AI</h3>
          <p>Click the Strike AI icon in your browser toolbar, enter your dispatch token, and save to connect your account.</p>
          <button class="sk-setup-btn" id="sk-open-popup">Open settings ↗</button>
        </div>
      `
      document.getElementById('sk-open-popup')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' })
      })
      return
    }

    const chips = [
      'Summarise this page',
      'Request financing',
      'Create a listing',
      'My active deals',
    ]

    body.innerHTML = `
      <div class="sk-messages" id="sk-messages"></div>
      <div class="sk-chips" id="sk-chips">
        ${chips.map(q => `<button class="sk-chip" data-q="${q}">${q}</button>`).join('')}
      </div>
      <div class="sk-err" id="sk-err"></div>
      <div class="sk-input-wrap">
        <div class="sk-input-row">
          <textarea class="sk-textarea" id="sk-input" rows="1" placeholder="Ask Strike AI…"></textarea>
          <button class="sk-send" id="sk-send" disabled>${ICON_SEND}</button>
        </div>
      </div>
    `

    document.querySelectorAll('.sk-chip').forEach(btn => {
      btn.addEventListener('click', () => sendMsg(btn.dataset.q))
    })

    const ta = document.getElementById('sk-input')
    const sb = document.getElementById('sk-send')

    ta.addEventListener('input', () => {
      sb.disabled = !ta.value.trim()
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 100) + 'px'
    })
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sb.disabled) sendMsg(ta.value) }
    })
    sb.addEventListener('click', () => sendMsg(ta.value))

    renderMessages()
  }

  function renderMessages() {
    const container = document.getElementById('sk-messages')
    if (!container) return

    if (!messages.length) {
      container.innerHTML = `
        <div class="sk-empty">
          <div class="sk-empty-orb">${ICON_LIGHTNING}</div>
          <h3>Ready to help</h3>
          <p>Ask me to analyse this page, pull your ERP data, or take an action on Strike.</p>
        </div>
      `
      return
    }

    container.innerHTML = messages.map(m => {
      const isUser = m.role === 'user'
      const bubble = isUser
        ? `<div class="sk-bubble user">${escHtml(m.text)}</div>`
        : `<div class="sk-bubble assistant">${renderMarkdown(m.text)}</div>`

      if (isUser) {
        return `<div class="sk-msg-wrap user">${bubble}<span class="sk-ts">${m.ts}</span></div>`
      }
      return `
        <div class="sk-msg-wrap assistant">
          <div class="sk-avatar assistant-av">S</div>
          ${bubble}
          <span class="sk-ts">${m.ts}</span>
        </div>
      `
    }).join('')

    if (loading) {
      container.innerHTML += `
        <div class="sk-msg-wrap assistant">
          <div class="sk-avatar assistant-av">S</div>
          <div class="sk-typing"><div class="sk-dot"></div><div class="sk-dot"></div><div class="sk-dot"></div></div>
        </div>
      `
    }

    container.scrollTop = container.scrollHeight
  }

  function escHtml(str) {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
  }

  // ─── Messaging ───────────────────────────────────────────────────────────

  function sendMsg(text) {
    if (!text?.trim() || loading) return
    const msg = text.trim()
    const ta = document.getElementById('sk-input')
    const sb = document.getElementById('sk-send')
    if (ta) { ta.value = ''; ta.style.height = 'auto' }
    if (sb) sb.disabled = true

    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    messages.push({ role: 'user', text: msg, ts })
    loading = true
    renderMessages()

    // Hide chips after first message
    const chips = document.getElementById('sk-chips')
    if (chips) chips.style.display = 'none'

    const isFirst = history.length === 0
    const dispatchMsg = isFirst && erpCtx ? `${erpCtx}\n\n---\n\n${msg}` : msg
    const snap = [...history]

    chrome.runtime.sendMessage(
      { type: 'DISPATCH', strikeUrl: config.strikeUrl, token: config.token, message: dispatchMsg, history: snap, source: 'erp_extension' },
      (res) => {
        loading = false
        if (chrome.runtime.lastError || res?.error) {
          const err = document.getElementById('sk-err')
          if (err) {
            err.textContent = res?.error ?? 'Connection error — check your token and Strike URL in the popup.'
            err.style.display = 'block'
            setTimeout(() => { if (err) err.style.display = 'none' }, 7000)
          }
          messages.pop()
          renderMessages()
          if (ta) ta.value = msg
          return
        }

        const reply = res.response ?? '(no response)'
        const replyTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        messages.push({ role: 'assistant', text: reply, ts: replyTs })
        history = [...snap, { role: 'user', content: dispatchMsg }, { role: 'assistant', content: reply }]
        renderMessages()
      }
    )
  }

  // ─── Open / Close ─────────────────────────────────────────────────────────

  function openSidebar() {
    isOpen = true
    document.getElementById('strike-sidebar')?.classList.add('open')
    document.getElementById('strike-pill')?.classList.add('hidden')
  }

  function closeSidebar() {
    isOpen = false
    document.getElementById('strike-sidebar')?.classList.remove('open')
    document.getElementById('strike-pill')?.classList.remove('hidden')
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (data) => {
    config = data ?? {}
    buildUI()
  })

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.strikeUrl || changes.token) {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (data) => {
        config = data ?? {}
        renderBody()
      })
    }
  })
})()
