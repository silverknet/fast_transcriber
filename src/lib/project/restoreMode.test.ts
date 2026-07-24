/**
 * Restore-mode arbitration — the fix for the bröllops-class "stranded in browser
 * mode" bug. The load-bearing property: prefer DISK when the sidecar is up and a
 * local copy exists, so a project never stays on compressed cloud audio while an
 * HD master sits on disk.
 */
import { describe, it, expect } from 'vitest'
import { chooseRestoreMode } from './restoreMode'

describe('chooseRestoreMode', () => {
  it('THE FIX: sidecar up + browser was last + a disk copy exists → open DISK', () => {
    // Exactly the bröllops case: last session was browser mode (lastPath erased),
    // but the sidecar is now up and this cloud project also lives on disk.
    expect(
      chooseRestoreMode({
        lastPath: null,
        lastCloudId: 'cloud-brollop',
        sidecarReachable: true,
        diskPathForCloudId: '/Users/x/Barbro projects/test1234',
      }),
    ).toEqual({ mode: 'disk', path: '/Users/x/Barbro projects/test1234' })
  })

  it('sidecar up + a last disk path → disk (normal desktop reload)', () => {
    expect(
      chooseRestoreMode({
        lastPath: '/Users/x/proj',
        lastCloudId: null,
        sidecarReachable: true,
        diskPathForCloudId: null,
      }),
    ).toEqual({ mode: 'disk', path: '/Users/x/proj' })
  })

  it('sidecar up + browser was last but NO local copy → stay browser-cloud', () => {
    // A pure collaborator with no disk copy on this machine.
    expect(
      chooseRestoreMode({
        lastPath: null,
        lastCloudId: 'cloud-abc',
        sidecarReachable: true,
        diskPathForCloudId: null,
      }),
    ).toEqual({ mode: 'cloud', cloudId: 'cloud-abc' })
  })

  it('sidecar DOWN + browser was last → browser-cloud (works offline)', () => {
    expect(
      chooseRestoreMode({
        lastPath: null,
        lastCloudId: 'cloud-abc',
        sidecarReachable: false,
        diskPathForCloudId: '/some/disk/path',
      }),
    ).toEqual({ mode: 'cloud', cloudId: 'cloud-abc' })
  })

  it('sidecar DOWN + only a disk path → try disk (caller fails gracefully)', () => {
    expect(
      chooseRestoreMode({
        lastPath: '/Users/x/proj',
        lastCloudId: null,
        sidecarReachable: false,
        diskPathForCloudId: null,
      }),
    ).toEqual({ mode: 'disk', path: '/Users/x/proj' })
  })

  it('nothing persisted → none', () => {
    expect(
      chooseRestoreMode({
        lastPath: null,
        lastCloudId: null,
        sidecarReachable: true,
        diskPathForCloudId: null,
      }),
    ).toEqual({ mode: 'none' })
  })

  it('disk path present always wins over cloud when the sidecar is up', () => {
    // If both keys somehow survive, the disk copy is the higher-fidelity choice.
    expect(
      chooseRestoreMode({
        lastPath: '/Users/x/proj',
        lastCloudId: 'cloud-abc',
        sidecarReachable: true,
        diskPathForCloudId: null,
      }),
    ).toEqual({ mode: 'disk', path: '/Users/x/proj' })
  })
})
