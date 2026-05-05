/**
 * Gzip a string using the native browser CompressionStream API.
 * Ableton .als files are gzip-compressed XML.
 */
export async function gzipString(text: string): Promise<Blob> {
  const encoded = new TextEncoder().encode(text)
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  const reader = cs.readable.getReader()

  const chunks: Uint8Array<ArrayBuffer>[] = []
  const drain = async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as Uint8Array<ArrayBuffer>)
    }
  }

  await Promise.all([
    writer.write(encoded).then(() => writer.close()),
    drain(),
  ])

  return new Blob(chunks, { type: 'application/octet-stream' })
}
