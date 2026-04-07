function audioBufferToWavBlob(buffer: AudioBuffer) {
  const channels = Math.min(2, buffer.numberOfChannels)
  const sampleRate = buffer.sampleRate
  const frames = buffer.length
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = frames * blockAlign
  const wavSize = 44 + dataSize

  const ab = new ArrayBuffer(wavSize)
  const view = new DataView(ab)

  let o = 0
  const writeU32 = (v: number) => {
    view.setUint32(o, v, true)
    o += 4
  }
  const writeU16 = (v: number) => {
    view.setUint16(o, v, true)
    o += 2
  }
  const writeAscii = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i))
  }

  writeAscii('RIFF')
  writeU32(36 + dataSize)
  writeAscii('WAVE')
  writeAscii('fmt ')
  writeU32(16)
  writeU16(1)
  writeU16(channels)
  writeU32(sampleRate)
  writeU32(byteRate)
  writeU16(blockAlign)
  writeU16(16)
  writeAscii('data')
  writeU32(dataSize)

  const ch: Float32Array[] = []
  for (let c = 0; c < channels; c++) ch.push(buffer.getChannelData(c))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, ch[c][i]))
      const pcm = s < 0 ? s * 0x8000 : s * 0x7fff
      view.setInt16(o, pcm, true)
      o += 2
    }
  }

  return new Blob([ab], { type: 'audio/wav' })
}

export async function trimAudioFileToWav(inputFile: File, startSec: number, endSec: number) {
  const ac = new AudioContext()
  try {
    const ab = await inputFile.arrayBuffer()
    const src = await ac.decodeAudioData(ab.slice(0))
    const s = Math.max(0, Math.min(startSec, src.duration))
    const e = Math.max(s, Math.min(endSec, src.duration))
    const i0 = Math.floor(s * src.sampleRate)
    const i1 = Math.max(i0 + 1, Math.ceil(e * src.sampleRate))
    const frames = Math.max(1, i1 - i0)

    const out = ac.createBuffer(src.numberOfChannels, frames, src.sampleRate)
    for (let c = 0; c < src.numberOfChannels; c++) {
      const segment = src.getChannelData(c).subarray(i0, i1)
      out.copyToChannel(segment, c, 0)
    }

    const blob = audioBufferToWavBlob(out)
    const base = inputFile.name.replace(/\.[^.]+$/, '')
    const file = new File([blob], `${base}_selected.wav`, { type: 'audio/wav' })
    return { file, durationSec: frames / src.sampleRate }
  } finally {
    await ac.close().catch(() => {})
  }
}
