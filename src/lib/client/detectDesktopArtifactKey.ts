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
        if (arch.includes('x86') || arch.includes('amd64') || arch.includes('386')) {
          return 'darwin-x64'
        }
        // No explicit arch signal (empty string, "unknown", etc. —
        // common on Chrome over HTTP and on browsers that partially
        // implement userAgentData). Default to arm64; see the legacy
        // branch below for the rationale.
        return 'darwin-arm64'
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
    // Default to arm64 on Mac. `navigator.platform === 'MacIntel'` and
    // a UA string containing "Intel Mac" are both unreliable: Safari
    // and Chrome hardcode them on Apple Silicon for fingerprint
    // reduction, so trusting either ends up flagging every Apple
    // Silicon user as Intel. Apple stopped selling Intel Macs in 2022;
    // the install base is overwhelmingly arm64. The handful of
    // remaining Intel users can pick their build from the "Other
    // platforms" list on the download page.
    return 'darwin-arm64'
  }

  return null
}
