import { env } from '$env/dynamic/public'
import {
  parseDesktopDownloadsManifest,
  type DesktopDownloadsManifest,
} from '$lib/desktop/downloadsManifest'

export type DownloadPageData = {
  manifest: DesktopDownloadsManifest | null
  manifestSource: 'remote' | 'static' | null
  manifestError: string | null
}

export async function load({ fetch, url }): Promise<DownloadPageData> {
  const remote = env.PUBLIC_DESKTOP_MANIFEST_URL?.trim()
  const targets: { label: string; href: string }[] = []

  if (remote) {
    targets.push({ label: 'remote manifest', href: remote })
  }
  targets.push({ label: 'static', href: new URL('/desktop-downloads.json', url).href })

  let lastErr: string | null = null
  for (const t of targets) {
    try {
      const res = await fetch(t.href, { cache: 'no-store' })
      if (!res.ok) {
        lastErr = `${t.label}: HTTP ${res.status}`
        continue
      }
      const json: unknown = await res.json()
      const manifest = parseDesktopDownloadsManifest(json)
      if (!manifest) {
        lastErr = `${t.label}: invalid manifest JSON`
        continue
      }
      return {
        manifest,
        manifestSource: remote && t.label === 'remote manifest' ? 'remote' : 'static',
        manifestError: null,
      }
    } catch (e) {
      lastErr = `${t.label}: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  return { manifest: null, manifestSource: null, manifestError: lastErr }
}
