/** SHA-256 hex from the client (anonymous device / browser signal bundle). */
const FINGERPRINT_HEX_RE = /^[0-9a-f]{64}$/i

export function parseFingerprintHeaderOrQuery(
  headerVal: string | null,
  queryVal: string | null,
): string | null {
  const raw = headerVal?.trim() || queryVal?.trim() || ''
  if (!FINGERPRINT_HEX_RE.test(raw)) return null
  return raw.toLowerCase()
}
