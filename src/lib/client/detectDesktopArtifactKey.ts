import type { DesktopArtifactKey } from '$lib/desktop/downloadsManifest'

type NavigatorUAData = Navigator & {
  userAgentData?: {
    mobile?: boolean
    platform?: string
    getHighEntropyValues?: (hints: readonly string[]) => Promise<Record<string, string>>
  }
}

/** Best-effort client-side mapping for recommended installer row. */
export async function detectDesktopArtifactKey(): Promise<DesktopArtifactKey | null> {
  if (typeof navigator === 'undefined') return null
  const uad = (navigator as NavigatorUAData).userAgentData
  if (uad?.mobile === true) return null

  if (uad?.getHighEntropyValues) {
    try {
      const h = await uad.getHighEntropyValues(['architecture', 'platform'] as const)
      const platform = (h.platform ?? uad.platform ?? '').toLowerCase()
      const arch = String(h.architecture ?? '').toLowerCase()

      if (platform.includes('win')) {
        return 'win-x64'
      }
      if (platform.includes('mac')) {
        if (arch.includes('arm') || arch.includes('aarch64')) return 'darwin-arm64'
        if (
          arch.includes('x86') ||
          arch.includes('amd64') ||
          arch.includes('386') ||
          arch === 'unknown'
        ) {
          return 'darwin-x64'
        }
      }
    } catch {
      // fall through
    }
  }

  const ua = navigator.userAgent
  const plat = navigator.platform

  if (/Win32|Win64|Windows/i.test(plat) || /Windows NT/i.test(ua)) {
    return 'win-x64'
  }

  if (/Mac|iPhone|iPod|iPad/i.test(plat)) {
    if (/arm64|aarch64/i.test(ua)) return 'darwin-arm64'
    if (/Intel Mac|x86_64/i.test(ua) || plat === 'MacIntel') return 'darwin-x64'
    return 'darwin-arm64'
  }

  return null
}
