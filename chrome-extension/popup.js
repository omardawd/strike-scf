document.addEventListener('DOMContentLoaded', () => {
  const urlInput   = document.getElementById('strikeUrl')
  const tokenInput = document.getElementById('token')
  const saveBtn    = document.getElementById('saveBtn')
  const chip       = document.getElementById('statusChip')
  const chipText   = document.getElementById('statusText')
  const toggleVis  = document.getElementById('toggleVis')

  // Show/hide token
  toggleVis?.addEventListener('click', () => {
    const isHidden = tokenInput.type === 'password'
    tokenInput.type = isHidden ? 'text' : 'password'
    toggleVis.textContent = isHidden ? '🙈' : '👁'
  })

  // Load saved config
  chrome.storage.sync.get(['strikeUrl', 'token'], (data) => {
    if (data.strikeUrl) urlInput.value = data.strikeUrl
    if (data.token)     tokenInput.value = data.token
    if (data.strikeUrl && data.token) showChip('Extension connected — tap ⚡ on any ERP page', 'connected')
  })

  saveBtn.addEventListener('click', () => {
    const strikeUrl = urlInput.value.trim().replace(/\/$/, '')
    const token     = tokenInput.value.trim()

    if (!strikeUrl) return showChip('Please enter your Strike Platform URL.', 'error')
    if (!token)     return showChip('Please enter your dispatch token.', 'error')

    try { new URL(strikeUrl) } catch {
      return showChip('Invalid URL — make sure to include https://', 'error')
    }

    chrome.storage.sync.set({ strikeUrl, token }, () => {
      showChip('Saved! The ⚡ Strike AI button will appear on ERP pages.', 'saved')
    })
  })

  function showChip(msg, type) {
    chip.className = `status-chip show ${type}`
    chipText.textContent = msg
    if (type !== 'connected') {
      setTimeout(() => { chip.classList.remove('show') }, 4000)
    }
  }
})
