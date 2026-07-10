import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'

export const XAIR_OSC_PORT = 10024
export const XAIR_REMOTE_KEEPALIVE_MS = 8_000

function pad4(n) {
  return (4 - (n % 4)) % 4
}

function encodeOscString(value) {
  const raw = Buffer.from(`${value}\0`, 'utf8')
  return Buffer.concat([raw, Buffer.alloc(pad4(raw.length))])
}

function readOscString(buf, offset) {
  let end = offset
  while (end < buf.length && buf[end] !== 0) end += 1
  if (end >= buf.length) throw new Error('OSC string is missing terminator')
  const value = buf.toString('utf8', offset, end)
  const next = end + 1 + pad4(end + 1 - offset)
  return { value, next }
}

export function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function xairChannelPath(channel, suffix) {
  const ch = Number.parseInt(String(channel), 10)
  if (!Number.isInteger(ch) || ch < 1 || ch > 18) throw new Error('XR18 channel must be 1..18')
  if (typeof suffix !== 'string' || !suffix.startsWith('/')) throw new Error('suffix must start with /')
  return `/ch/${String(ch).padStart(2, '0')}${suffix}`
}

export function xairChannelFaderPath(channel) {
  return xairChannelPath(channel, '/mix/fader')
}

export function xairChannelOnPath(channel) {
  return xairChannelPath(channel, '/mix/on')
}

export function xairChannelBusSendPath(channel, bus) {
  const busNum = Number.parseInt(String(bus), 10)
  if (!Number.isInteger(busNum) || busNum < 1 || busNum > 6) throw new Error('XR18 bus must be 1..6')
  return xairChannelPath(channel, `/mix/${String(busNum).padStart(2, '0')}/level`)
}

export function xairMainFaderPath() {
  return '/lr/mix/fader'
}

export function normalizeOscArg(arg) {
  if (typeof arg === 'number') {
    if (Number.isInteger(arg)) return { type: 'i', value: arg }
    return { type: 'f', value: arg }
  }
  if (typeof arg === 'boolean') return { type: 'i', value: arg ? 1 : 0 }
  if (typeof arg === 'string') return { type: 's', value: arg }
  if (arg && typeof arg === 'object' && typeof arg.type === 'string') {
    if (arg.type === 'i') return { type: 'i', value: Number.parseInt(String(arg.value), 10) || 0 }
    if (arg.type === 'f') return { type: 'f', value: Number(arg.value) || 0 }
    if (arg.type === 's') return { type: 's', value: String(arg.value ?? '') }
  }
  throw new Error(`Unsupported OSC argument: ${String(arg)}`)
}

export function encodeOscMessage(address, args = []) {
  if (typeof address !== 'string' || !address.startsWith('/')) {
    throw new Error('OSC address must start with /')
  }
  const normalized = args.map(normalizeOscArg)
  const chunks = [encodeOscString(address), encodeOscString(`,${normalized.map((a) => a.type).join('')}`)]
  for (const arg of normalized) {
    if (arg.type === 'i') {
      const b = Buffer.alloc(4)
      b.writeInt32BE(arg.value, 0)
      chunks.push(b)
    } else if (arg.type === 'f') {
      const b = Buffer.alloc(4)
      b.writeFloatBE(arg.value, 0)
      chunks.push(b)
    } else if (arg.type === 's') {
      chunks.push(encodeOscString(arg.value))
    }
  }
  return Buffer.concat(chunks)
}

export function decodeOscMessage(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  const address = readOscString(buf, 0)
  const tags = readOscString(buf, address.next)
  if (!tags.value.startsWith(',')) throw new Error('OSC type tag string must start with comma')
  let offset = tags.next
  const args = []
  for (const type of tags.value.slice(1)) {
    if (type === 'i') {
      if (offset + 4 > buf.length) throw new Error('OSC int argument is truncated')
      args.push({ type, value: buf.readInt32BE(offset) })
      offset += 4
    } else if (type === 'f') {
      if (offset + 4 > buf.length) throw new Error('OSC float argument is truncated')
      args.push({ type, value: buf.readFloatBE(offset) })
      offset += 4
    } else if (type === 's') {
      const s = readOscString(buf, offset)
      args.push({ type, value: s.value })
      offset = s.next
    } else {
      throw new Error(`Unsupported OSC type tag: ${type}`)
    }
  }
  return { address: address.value, args }
}

export function createXAirClient({ host, port = XAIR_OSC_PORT, localPort = 0, keepaliveMs = XAIR_REMOTE_KEEPALIVE_MS } = {}) {
  if (typeof host !== 'string' || host.trim().length === 0) throw new Error('XR18 host is required')
  const cleanHost = host.trim()
  const cleanPort = Number.parseInt(String(port), 10)
  if (!Number.isInteger(cleanPort) || cleanPort < 1 || cleanPort > 65535) throw new Error('XR18 port must be 1..65535')

  const events = new EventEmitter()
  const socket = dgram.createSocket('udp4')
  let keepalive = null
  let connected = false
  let opening = null

  const send = (address, args = []) => {
    const msg = encodeOscMessage(address, args)
    socket.send(msg, cleanPort, cleanHost)
  }

  socket.on('message', (msg, rinfo) => {
    try {
      events.emit('message', { ...decodeOscMessage(msg), remote: { address: rinfo.address, port: rinfo.port } })
    } catch (e) {
      events.emit('error', e)
    }
  })
  socket.on('error', (e) => events.emit('error', e))

  return {
    host: cleanHost,
    port: cleanPort,
    events,
    async open() {
      if (connected) return
      if (opening) return opening
      opening = new Promise((resolve, reject) => {
        const onListening = () => {
          socket.off('error', onBindError)
          connected = true
          send('/xremote')
          keepalive = setInterval(() => send('/xremote'), keepaliveMs)
          keepalive.unref?.()
          events.emit('state', { connected: true, host: cleanHost, port: cleanPort })
          resolve()
        }
        const onBindError = (e) => {
          socket.off('listening', onListening)
          reject(e)
        }
        socket.once('listening', onListening)
        socket.once('error', onBindError)
        socket.bind(localPort)
      }).finally(() => {
        opening = null
      })
      return opening
    },
    close() {
      if (keepalive) clearInterval(keepalive)
      keepalive = null
      if (connected) {
        connected = false
        try {
          socket.close()
        } catch {
          /* socket may already be closed after an error */
        }
      }
      events.emit('state', { connected: false, host: cleanHost, port: cleanPort })
    },
    send,
    requestInfo() {
      send('/xinfo')
    },
    setChannelFader(channel, value) {
      send(xairChannelFaderPath(channel), [{ type: 'f', value: clamp01(value) }])
    },
    setMainFader(value) {
      send(xairMainFaderPath(), [{ type: 'f', value: clamp01(value) }])
    },
    setChannelOn(channel, on) {
      send(xairChannelOnPath(channel), [{ type: 'i', value: on ? 1 : 0 }])
    },
    setChannelBusSend(channel, bus, value) {
      send(xairChannelBusSendPath(channel, bus), [{ type: 'f', value: clamp01(value) }])
    },
    status() {
      return { connected, host: cleanHost, port: cleanPort }
    },
  }
}
