/**
 * Real-browser interaction tests for the draft switcher.
 *
 * The draft logic is covered by unit tests; what those cannot see is whether
 * the UI actually behaves like a radio list — that clicking a row selects it,
 * that the action buttons don't, that the selected draft can't be deleted, and
 * that row order doesn't shift under the cursor when the selection changes.
 */
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import SongDraftsList, { type DraftRow } from './SongDraftsList.svelte'

const ROWS: DraftRow[] = [
  { id: 'd-my', name: 'My draft', active: false, counts: '4 chords · 2 sections' },
  { id: 'd-sheet', name: 'Sheet import', active: true, counts: '12 chords · 5 sections · lyrics' },
  { id: 'd-alt', name: 'Slow version', active: false, counts: '9 chords · 4 sections' },
]

function setup(overrides: Record<string, unknown> = {}) {
  const calls = {
    use: [] as string[],
    rename: [] as string[],
    del: [] as string[],
    duplicate: 0,
    newEmpty: 0,
  }
  const screen = render(SongDraftsList, {
    rows: ROWS,
    onUse: (id: string) => calls.use.push(id),
    onRename: (id: string) => calls.rename.push(id),
    onDelete: (id: string) => calls.del.push(id),
    onDuplicate: () => calls.duplicate++,
    onNewEmpty: () => calls.newEmpty++,
    ...overrides,
  })
  return { screen, calls }
}

describe('draft switcher (real browser)', () => {
  it('renders one row per draft', async () => {
    const { screen } = setup()
    await expect.element(screen.getByText('Sheet import')).toBeInTheDocument()
    expect(screen.getByTestId('draft-row').elements()).toHaveLength(3)
  })

  it('exposes the rows as a radio group with exactly one selected', async () => {
    setup()
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="song-draft"]'),
    )
    expect(radios).toHaveLength(3)
    expect(radios.filter((r) => r.checked)).toHaveLength(1)
    expect(radios.find((r) => r.checked)?.value).toBe('d-sheet')
  })

  it('selecting a row reports that draft', async () => {
    const { screen, calls } = setup()
    await screen.getByRole('radio', { name: 'Slow version' }).click()
    expect(calls.use).toEqual(['d-alt'])
  })

  it('clicking rename does NOT also select the row', async () => {
    // Verified against the real DOM rather than assumed: a click on an action
    // button must report only that action, never a draft switch.
    const { screen, calls } = setup()
    await screen.getByRole('button', { name: 'Rename draft Slow version' }).click()
    expect(calls.rename).toEqual(['d-alt'])
    expect(calls.use).toEqual([])
  })

  it('clicking delete does NOT also select the row', async () => {
    const { screen, calls } = setup()
    await screen.getByRole('button', { name: 'Delete draft My draft' }).click()
    expect(calls.del).toEqual(['d-my'])
    expect(calls.use).toEqual([])
  })

  it('the selected draft cannot be deleted', async () => {
    setup()
    const del = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete draft Sheet import"]',
    )
    expect(del?.disabled).toBe(true)
    // ...while an inactive one can be.
    const other = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete draft My draft"]',
    )
    expect(other?.disabled).toBe(false)
  })

  it('row order does not depend on which row is selected', async () => {
    const names = () =>
      Array.from(document.querySelectorAll('input[name="song-draft"]')).map((r) =>
        r.getAttribute('aria-label'),
      )
    const first = setup()
    const before = names()
    first.screen.unmount()

    // Same rows, a different one active — the order must be identical.
    const moved = ROWS.map((r) => ({ ...r, active: r.id === 'd-alt' }))
    render(SongDraftsList, { rows: moved })
    expect(names()).toEqual(before)
  })

  it('footer actions report without touching selection', async () => {
    const { screen, calls } = setup()
    await screen.getByRole('button', { name: 'Duplicate this draft' }).click()
    await screen.getByRole('button', { name: 'New empty draft' }).click()
    expect(calls.duplicate).toBe(1)
    expect(calls.newEmpty).toBe(1)
    expect(calls.use).toEqual([])
  })

  it('shows a status message when one is supplied', async () => {
    const { screen } = setup({ message: 'Switched to “Slow version” — “Sheet import” is kept.' })
    await expect.element(screen.getByRole('status')).toHaveTextContent('Slow version')
  })
})
