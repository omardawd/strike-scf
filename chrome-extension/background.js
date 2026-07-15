// Service worker — proxies Strike AI dispatch calls from content scripts.
// Content scripts can't call cross-origin endpoints directly, so they
// send a message here and we make the fetch on their behalf.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'DISPATCH') {
    handleDispatch(msg).then(sendResponse).catch((err) =>
      sendResponse({ error: err.message ?? 'Request failed' })
    )
    return true // keep message channel open for async response
  }

  if (msg.type === 'GET_CONFIG') {
    chrome.storage.sync.get(['strikeUrl', 'token'], sendResponse)
    return true
  }
})

async function handleDispatch({ strikeUrl, token, message, history, source }) {
  const url = `${strikeUrl}/api/ai/dispatch`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      message,
      source: source ?? 'erp_extension',
      history: history ?? [],
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody.error ?? `HTTP ${res.status}`)
  }

  return res.json()
}
