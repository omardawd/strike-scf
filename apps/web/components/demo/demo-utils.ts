// Shared low-level helpers used by DemoConductor and DemoAgentActivityFeed.
// Kept dependency-free (no React) so either can import without cycles.

// Polls for a `data-demo-target` element to actually mount (real navigation +
// render, not a fixed guess) before revealing/acting on it. Resolves early
// once found; otherwise gives up after `timeoutMs` so a missing/renamed
// target can never hang the whole sequence.
export function waitForTarget(selector: string, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const deadline = performance.now() + timeoutMs
    function check() {
      if (document.querySelector(`[data-demo-target="${selector}"]`)) { resolve(); return }
      if (performance.now() > deadline) { resolve(); return }
      requestAnimationFrame(check)
    }
    check()
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Waits until the browser is actually ON the beat's route before anyone looks
// for that beat's `data-demo-target`. router.push() resolves long before the
// new page commits, and during that gap the OUTGOING page is still mounted —
// so a target lookup can match a stale element (or the right name on the wrong
// page) and the spotlight lands on the previous scene's component. Compares
// pathname only; `route` may carry a query string (e.g. /settings?tab=erp).
export function waitForRoute(route: string, timeoutMs: number): Promise<void> {
  const wanted = route.split('?')[0]
  return new Promise(resolve => {
    const deadline = performance.now() + timeoutMs
    function check() {
      if (window.location.pathname === wanted) { resolve(); return }
      if (performance.now() > deadline) { resolve(); return }
      requestAnimationFrame(check)
    }
    check()
  })
}
