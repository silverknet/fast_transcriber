/**
 * Minimal WAV duration from buffer (PCM). Trimming on the client produces WAV.
 */
export function readWavDurationSec(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a RIFF/WAV buffer')
  }

  let offset = 12
  let sampleRate = 44100
  let numChannels = 2
  let bitsPerSample = 16
  let dataSize = 0
  let foundData = false

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (id === 'fmt ' && size >= 16) {
      numChannels = buffer.readUInt16LE(chunkStart + 2)
      sampleRate = buffer.readUInt32LE(chunkStart + 4)
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14)
    } else if (id === 'data') {
      dataSize = size
      foundData = true
      break
    }
    offset = chunkStart + size + (size % 2)
  }

  if (!foundData || sampleRate <= 0 || numChannels <= 0 || bitsPerSample <= 0) {
    throw new Error('Could not parse WAV data chunk')
  }

  const bytesPerFrame = numChannels * (bitsPerSample / 8)
  const numFrames = dataSize / bytesPerFrame
  return numFrames / sampleRate
}
