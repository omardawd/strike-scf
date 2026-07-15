// SSRF guard for server-side fetches of user-supplied URLs (e.g. ERP base_url).
//
// Any endpoint that fetches a URL the user controls can be abused to reach
// internal-only targets: cloud metadata (169.254.169.254 → IAM credentials),
// loopback services, and RFC1918 hosts. We resolve the hostname and reject if
// ANY resolved address falls in a private/reserved range — which also defeats
// hostnames that are crafted to resolve to internal IPs.
import { lookup } from 'node:dns/promises'
import net from 'node:net'

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const o = Number(p)
    if (!Number.isInteger(o) || o < 0 || o > 255) return null
    n = (n << 8) | o
  }
  return n >>> 0
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  if (n === null) return true // unparseable → treat as unsafe
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (b & mask)
  }
  return (
    inRange('0.0.0.0', 8) ||        // "this" network
    inRange('10.0.0.0', 8) ||       // private
    inRange('100.64.0.0', 10) ||    // CGNAT
    inRange('127.0.0.0', 8) ||      // loopback
    inRange('169.254.0.0', 16) ||   // link-local + cloud metadata
    inRange('172.16.0.0', 12) ||    // private
    inRange('192.0.0.0', 24) ||     // IETF protocol assignments
    inRange('192.168.0.0', 16) ||   // private
    inRange('198.18.0.0', 15) ||    // benchmarking
    inRange('224.0.0.0', 4) ||      // multicast
    inRange('240.0.0.0', 4)         // reserved
  )
}

function isPrivateV6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]!
  if (addr === '::1' || addr === '::') return true
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateV4(mapped[1]!)
  return (
    addr.startsWith('fc') || addr.startsWith('fd') ||  // ULA fc00::/7
    addr.startsWith('fe8') || addr.startsWith('fe9') || // link-local fe80::/10
    addr.startsWith('fea') || addr.startsWith('feb')
  )
}

function isPrivateAddress(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateV4(ip) : isPrivateV6(ip)
}

/**
 * Throws if `rawUrl` is not a safe, public http(s) URL. Call before any
 * server-side fetch of a user-controlled URL.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('URL host is not permitted')
  }

  // If the host is an IP literal, check it directly.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('URL resolves to a private address')
    return url
  }

  // Otherwise resolve DNS and reject if any address is private/reserved.
  let addrs: { address: string }[]
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    throw new Error('Could not resolve URL host')
  }
  if (addrs.length === 0) throw new Error('Could not resolve URL host')
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new Error('URL resolves to a private address')
  }
  return url
}
