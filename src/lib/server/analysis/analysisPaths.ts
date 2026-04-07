import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Path to `analyze_downbeats.py` (repo layout: src/lib/server/analysis/python/).
 */
export function getAnalyzeDownbeatsScriptPath(): string {
  const fromEnv = process.env.BARBRO_ANALYZE_SCRIPT?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const cwd = join(process.cwd(), 'src/lib/server/analysis/python/analyze_downbeats.py')
  if (existsSync(cwd)) return cwd

  const here = fileURLToPath(new URL('./python/analyze_downbeats.py', import.meta.url))
  if (existsSync(here)) return here

  return cwd
}
