/**
 * ARMING IS NEVER REMEMBERED — a census, not a unit test.
 *
 * "Live follow" is the one mode where BarBro asserts its own faders, sends and
 * bus masters over whatever is on the console. Every other desk write is
 * either safety (click and cue off the house) or a button somebody pressed.
 *
 * Both panels used to restore that flag from `localStorage`. So a laptop armed
 * once at a rehearsal came back armed after every reload, connected to the
 * desk, and started driving it — over an evening of settings a person had
 * built by hand at the console, with no action and no warning. The comment in
 * the source said arming was "deliberately not inherited" while the code three
 * lines below inherited it.
 *
 * A unit test cannot fail on a THIRD panel that reintroduces the pattern. A
 * census can. If this test just failed on your change: you added a way for
 * BarBro to start driving a desk without a person deciding to. Don't persist
 * it. Arming is a deliberate act, once per session, by someone looking at the
 * console.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

/** Reading the flag back out of any persisted blob. */
const RESTORES_ARM = /\barmed\s*=\s*[A-Za-z_$][\w$]*\.armed\b/
/** Writing it into one. */
const PERSISTS_ARM = /localStorage\.setItem\([^)]*\)|\barmed\s*,/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

/** Files that both talk to the desk AND persist something. */
function deskPersistingFiles(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const full of walk(SRC)) {
    const text = readFileSync(full, 'utf8')
    if (!text.includes('hardwareBridge')) continue
    out.push({ file: full.slice(SRC.length + 1).replace(/\\/g, '/'), text })
  }
  return out
}

describe('arm-persistence sentinel', () => {
  const files = deskPersistingFiles()

  it('finds the components that talk to the desk (the census is not vacuously empty)', () => {
    // A census that matches nothing passes forever while proving nothing.
    expect(files.map((f) => f.file)).toContain('lib/components/XAirSettingsPanel.svelte')
    expect(files.map((f) => f.file)).toContain('lib/components/LiveHardwareStrip.svelte')
  })

  it('no component restores the arm flag from storage', () => {
    const offenders = files
      .filter((f) => RESTORES_ARM.test(f.text))
      .map((f) => f.file)
    expect(
      offenders,
      `These restore "live follow" from storage, so BarBro starts driving a desk nobody armed this session:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('no component writes the arm flag into its stored config', () => {
    const offenders = files
      .filter((f) => /const cfg: StoredConfig = \{[^}]*\barmed\b/.test(f.text))
      .map((f) => f.file)
    expect(
      offenders,
      `These persist the arm flag. Even unread it is a trap for the next person:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('arming still exists and still starts OFF', () => {
    // The rule is "not remembered", NOT "removed" — deleting the feature would
    // also make the two tests above pass, and that is not the fix.
    const armable = files.filter((f) => /let armed = \$state\(false\)/.test(f.text))
    expect(armable.length).toBeGreaterThan(0)
    for (const f of armable) {
      expect(f.text, `${f.file} must still be able to arm deliberately`).toMatch(
        /function setArmed\(/,
      )
    }
  })
})
