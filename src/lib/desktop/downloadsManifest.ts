/** Keys for desktop installer rows in `desktop-downloads.json` / remote manifest. */
export type DesktopArtifactKey = 'darwin-arm64' | 'darwin-x64' | 'win-x64'

export const DESKTOP_ARTIFACT_KEYS: DesktopArtifactKey[] = ['darwin-arm64', 'darwin-x64', 'win-x64']

export type DesktopArtifactEntry = {
  label: string
  url: string
}

export type DesktopDownloadsManifest = {
  version: string
  artifacts: Partial<Record<DesktopArtifactKey, DesktopArtifactEntry>>
}

export function isDesktopArtifactKey(s: string): s is DesktopArtifactKey {
  return DESKTOP_ARTIFACT_KEYS.includes(s as DesktopArtifactKey)
}

export function parseDesktopDownloadsManifest(raw: unknown): DesktopDownloadsManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const version = typeof o.version === 'string' ? o.version : '0.0.0'
  const rawArtifacts = o.artifacts
  if (!rawArtifacts || typeof rawArtifacts !== 'object') return null
  const artifacts: Partial<Record<DesktopArtifactKey, DesktopArtifactEntry>> = {}
  for (const key of Object.keys(rawArtifacts)) {
    if (!isDesktopArtifactKey(key)) continue
    const e = (rawArtifacts as Record<string, unknown>)[key]
    if (!e || typeof e !== 'object') continue
    const er = e as Record<string, unknown>
    const label = typeof er.label === 'string' ? er.label : key
    const url = typeof er.url === 'string' ? er.url : ''
    artifacts[key] = { label, url }
  }
  return { version, artifacts }
}
