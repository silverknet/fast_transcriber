import { describe, expect, it } from 'vitest'
import { planCloudAudioUpload } from './cloudAudioSync'

describe('planCloudAudioUpload', () => {
  const tasks = planCloudAudioUpload({
    projectId: 'proj',
    songId: 'song',
    mixSrcSubpath: 'audio/master.wav',
    stems: { Bass: 'stems/best/bass.wav', Vocals: 'stems/best/vocals.wav' },
  })

  it('mix task comes first with cloud/mix.m4a → bucket mix path', () => {
    expect(tasks[0]).toMatchObject({
      kind: 'mix',
      srcSubpath: 'audio/master.wav',
      dstSubpath: 'cloud/mix.m4a',
      storagePath: 'proj/song/mix.m4a',
    })
  })

  it('one task per stem, slugged dst + bucket path', () => {
    const bass = tasks.find((t) => t.stemName === 'Bass')!
    expect(bass.srcSubpath).toBe('stems/best/bass.wav')
    expect(bass.dstSubpath).toBe('cloud/stems/bass.m4a')
    expect(bass.storagePath).toBe('proj/song/stems/bass.m4a')
    expect(tasks).toHaveLength(3) // mix + 2 stems
  })

  it('every storage path keeps the project id as the first segment (RLS)', () => {
    for (const t of tasks) expect(t.storagePath.split('/')[0]).toBe('proj')
  })

  it('handles a mix-only song (no stems)', () => {
    const only = planCloudAudioUpload({ projectId: 'p', songId: 's', mixSrcSubpath: 'audio/x.flac', stems: {} })
    expect(only).toHaveLength(1)
    expect(only[0]!.kind).toBe('mix')
  })
})
