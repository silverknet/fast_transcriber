/**
 * Anonymous browser signal bundle → SHA-256 hex (no accounts).
 * Not uniquely identifying; stable enough to re-attach a server session on the same profile.
 */
export async function computeBrowserFingerprintHash(): Promise<string> {
  const nav = navigator
  const parts = [
    nav.userAgent || '',
    nav.language || '',
    typeof nav.hardwareConcurrency === 'number' ? String(nav.hardwareConcurrency) : '',
    typeof screen !== 'undefined' ? `${screen.width}x${screen.height}x${screen.colorDepth}` : '',
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    nav.platform || '',
  ]
  const enc = new TextEncoder().encode(parts.join('|'))
  const digest = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
