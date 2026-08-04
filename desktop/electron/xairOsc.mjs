import dgram from 'node:dgram'
import os from 'node:os'
import { EventEmitter } from 'node:events'

export const XAIR_OSC_PORT = 10024
export const XAIR_REMOTE_KEEPALIVE_MS = 8_000

/**
 * How often to re-ask for metering.
 *
 * The desk drops a meter subscription after roughly ten seconds. Renewing every
 * two keeps it alive with enough margin that a couple of lost UDP packets — which
 * this link demonstrably drops — do not produce a gap that looks like silence.
 */
export const XAIR_METER_RENEW_MS = 2_000

function pad4(n) {
  return (4 - (n % 4)) % 4
}

export function encodeOscString(value) {
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

/**
 * The XR18 has SIXTEEN channel strips, not eighteen.
 *
 * `/ch/17` and `/ch/18` do not exist — verified against a real XR18V2 (fw 1.19),
 * which answers `/ch/16/mix/fader` and stays silent for 17 and 18. The 17/18
 * strip is the stereo aux return, addressed as `/rtn/aux/...`.
 *
 * This mattered: click and cue were routed to channels 17 and 18, so every
 * write vanished into an address the desk does not have. Silently — X-AIR
 * ignores unknown addresses with no reply and no error.
 */
export const XAIR_CHANNEL_COUNT = 16

export function xairChannelPath(channel, suffix) {
  const ch = Number.parseInt(String(channel), 10)
  if (!Number.isInteger(ch) || ch < 1 || ch > XAIR_CHANNEL_COUNT) {
    throw new Error(`XR18 channel must be 1..${XAIR_CHANNEL_COUNT} (17/18 is the aux return, /rtn/aux)`)
  }
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

/** Main/LR bus ASSIGN — the ONE control that takes a channel off the house mix. */
export function xairChannelMainAssignPath(channel) {
  return xairChannelPath(channel, '/mix/lr')
}

/**
 * Aux-bus MASTER fader (bus 1..6) — a performer's overall in-ear level.
 *
 * SINGLE-DIGIT. `/bus/01/mix/fader` does not exist; `/bus/1/mix/fader` does.
 * Verified on a real XR18V2. The zero-padded form was silently doing nothing,
 * so every monitor-level write was lost.
 *
 * Note the inconsistency is the DESK's, not ours: channel→bus SENDS are padded
 * (`/ch/09/mix/01/level`) while bus masters are not. Both verified.
 */
export const XAIR_BUS_COUNT = 6

export function xairBusFaderPath(bus) {
  const busNum = Number.parseInt(String(bus), 10)
  if (!Number.isInteger(busNum) || busNum < 1 || busNum > XAIR_BUS_COUNT) {
    throw new Error(`XR18 bus must be 1..${XAIR_BUS_COUNT}`)
  }
  return `/bus/${busNum}/mix/fader`
}

/** The stereo aux return — the strip the desk calls 17/18. */
export function xairAuxReturnPath(suffix) {
  if (typeof suffix !== 'string' || !suffix.startsWith('/')) throw new Error('suffix must start with /')
  return `/rtn/aux${suffix}`
}

/** Is this channel USB-fed? `/ch/NN/preamp/rtnsw`: 0 = socket, 1 = USB. */
export function xairChannelUsbSwitchPath(channel) {
  return xairChannelPath(channel, '/preamp/rtnsw')
}

/** WHICH USB channel feeds this strip. `/ch/NN/config/rtnsrc`, zero-based. */
export function xairChannelUsbSourcePath(channel) {
  return xairChannelPath(channel, '/config/rtnsrc')
}

/**
 * Stereo-link a FIXED pair: `/config/chlink/9-10`. One fader for a stereo
 * source instead of two that drift apart on the band's phones.
 *
 * The pairs are the only ones the desk has. `/config/chlink/6-7` is not an
 * address — X-Air drops unknown addresses in silence, which reads exactly like
 * success, so this refuses rather than sends.
 */
export const XAIR_CHANNEL_LINK_PAIRS = ['1-2', '3-4', '5-6', '7-8', '9-10', '11-12', '13-14', '15-16']

export function xairChannelLinkPath(pair) {
  if (!XAIR_CHANNEL_LINK_PAIRS.includes(pair)) throw new Error(`Not a channel-link pair: ${pair}`)
  return `/config/chlink/${pair}`
}

export function xairMainFaderPath() {
  return '/lr/mix/fader'
}

/**
 * THE WRITE WHITELIST for the raw integer endpoint.
 *
 * Everything here is CONFIGURATION — what a strip listens to, and whether two
 * strips move together. None of it can raise a level, which is the property
 * that lets the sidecar accept these writes at all: a bug here changes routing,
 * never loudness. Anything that moves a fader goes through its own endpoint
 * with its own clamp.
 */
export const XAIR_WRITABLE_INT_ADDRESSES = [
  /^\/ch\/(0[1-9]|1[0-6])\/preamp\/rtnsw$/, // socket (0) or USB (1)
  /^\/ch\/(0[1-9]|1[0-6])\/config\/rtnsrc$/, // which USB channel, zero-based
  /^\/config\/chlink\/(1-2|3-4|5-6|7-8|9-10|11-12|13-14|15-16)$/, // stereo pair
]

export function isXAirWritableIntAddress(address) {
  return typeof address === 'string' && XAIR_WRITABLE_INT_ADDRESSES.some((re) => re.test(address))
}

/**
 * Parse an accumulated `{ address: args }` readback into per-channel state
 * (`lr`/`on`/`fader`). Used to PROVE click/cue are off the house: an int `lr` of
 * 0 = off the main bus. Pure + testable.
 */
export function parseXAirChannelState(rawState) {
  const channels = {}
  const touch = (ch) => (channels[ch] ??= {})
  for (const [address, args] of Object.entries(rawState || {})) {
    const m = /^\/ch\/(\d{2})\/mix\/(lr|on|fader)$/.exec(address)
    if (!m || !Array.isArray(args) || args.length === 0) continue
    const ch = Number.parseInt(m[1], 10)
    touch(ch)[m[2]] = args[0].value
  }
  return { channels }
}

/**
 * Turn a `/meters/N` blob into levels in dB.
 *
 * The desk reports what it is HEARING, which is the only evidence that survives
 * the question "is BarBro actually reaching this channel?". A write proves
 * nothing — X-Air ignores addresses it does not have without a word — and a
 * meter on our own output only proves what we sent, never what arrived.
 *
 * Layout, confirmed against a real XR18V2: int32 count, then `count` int16
 * values, ALL LITTLE-ENDIAN — unlike every other field in OSC, which is big.
 * Each value is dB × 256, so −128.0 dB (the floor, meaning true silence) comes
 * across as −32768.
 */
export const XAIR_METER_FLOOR_DB = -128

export function decodeXAirMeters(blob) {
  if (!Buffer.isBuffer(blob) || blob.length < 4) return []
  const count = blob.readInt32LE(0)
  if (!Number.isInteger(count) || count < 0) return []
  const out = []
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 2
    // A truncated packet reports FEWER meters rather than inventing silence for
    // the rest. Silence and "no answer" must never look the same.
    if (at + 2 > blob.length) break
    out.push(blob.readInt16LE(at) / 256)
  }
  return out
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
    } else if (type === 'b') {
      // BLOBS — how the desk sends metering.
      //
      // Rejecting this tag made meters unreachable: `/meters/1` replies arrive
      // as one blob, the decoder threw, and the packet was dropped before
      // anything could read it. So the app could never see a level the desk
      // reported, and every "is there signal?" question fell back to asking a
      // human to look at the console.
      //
      // The payload is int32 length + bytes, padded to a 4-byte boundary — and
      // the padding rule is `(n + 3) & ~3`, NOT `(n + 4) & ~3`. The latter
      // over-pads whenever the length is already a multiple of four, which is
      // most of the time, and silently desynchronises everything after it.
      if (offset + 4 > buf.length) throw new Error('OSC blob length is truncated')
      const size = buf.readInt32BE(offset)
      offset += 4
      if (size < 0 || offset + size > buf.length) throw new Error('OSC blob is truncated')
      args.push({ type, value: buf.subarray(offset, offset + size) })
      offset += (size + 3) & ~3
    } else {
      throw new Error(`Unsupported OSC type tag: ${type}`)
    }
  }
  return { address: address.value, args }
}

/**
 * How long to wait for the desk to identify itself.
 *
 * On a local network the reply comes back in single-digit milliseconds. This is
 * generous enough for congested venue Wi-Fi and short enough that a wrong IP
 * fails while you are still looking at the screen.
 */
export const XAIR_IDENTIFY_TIMEOUT_MS = 1500

/**
 * FIND EVERY X-AIR ON THE NETWORK.
 *
 * The desk has no screen, so its IP address is genuinely unknowable without
 * either the router's admin page or X AIR Edit's own scanner. Asking a musician
 * to type an IP at load-in is asking for the wrong one — and a wrong one is
 * indistinguishable from a desk that is switched off, because UDP is
 * connectionless and nothing reports a failure.
 *
 * Every X-Air answers `/xinfo` with its address, name, model and firmware. So
 * broadcast the question and listen: whatever answers IS a mixer, and it tells
 * us what it is. No guessing, no configuration.
 *
 * Broadcasts go to the calculated broadcast address of each IPv4 interface as
 * well as 255.255.255.255 — some networks drop the global one, some drop the
 * subnet one, and sending both costs nothing.
 */
export async function discoverXAirConsoles({ waitMs = 1500, port = XAIR_OSC_PORT } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  const found = new Map()

  socket.on('message', (msg, rinfo) => {
    try {
      const decoded = decodeOscMessage(msg)
      if (decoded.address !== '/xinfo') return
      const s = decoded.args.filter((a) => a.type === 's').map((a) => a.value)
      // Keyed by the address we actually reached it on, not the one it reports —
      // a desk with a stale configured address would otherwise be unreachable
      // at the very address we hand back.
      found.set(rinfo.address, {
        ip: rinfo.address,
        reportedIp: s[0] ?? null,
        name: s[1] ?? null,
        model: s[2] ?? null,
        firmware: s[3] ?? null,
      })
    } catch {
      /* not for us */
    }
  })

  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, resolve)
  })

  try {
    socket.setBroadcast(true)
    const targets = new Set(['255.255.255.255'])
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family !== 'IPv4' || ni.internal) continue
        const addr = ni.address.split('.').map(Number)
        const mask = ni.netmask.split('.').map(Number)
        if (addr.length !== 4 || mask.length !== 4) continue
        targets.add(addr.map((o, i) => (o | (~mask[i] & 255)) & 255).join('.'))
      }
    }
    const question = encodeOscMessage('/xinfo')
    // Twice, spaced: this link demonstrably drops UDP packets, and a desk missed
    // on the first sweep reads as "no mixer here".
    for (let round = 0; round < 2; round++) {
      for (const t of targets) {
        try {
          socket.send(question, port, t)
        } catch {
          /* an interface that will not broadcast is not an error */
        }
      }
      await new Promise((r) => setTimeout(r, Math.min(400, waitMs / 3)))
    }
    await new Promise((r) => setTimeout(r, waitMs))
    return [...found.values()]
  } finally {
    try {
      socket.close()
    } catch {
      /* already closed */
    }
  }
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
  // Accumulated desk readback (address → args), fed by /xremote echoes + query
  // replies. This is what lets a "prove it" verify read the console's real state.
  const state = new Map()

  const send = (address, args = []) => {
    const msg = encodeOscMessage(address, args)
    socket.send(msg, cleanPort, cleanHost)
  }

  // Latest metering frame, and when it arrived. Kept OUT of `state` because a
  // meter is a moment, not a setting: leaving it in the readback map would let
  // a stale level be mistaken for a desk value that had been asked for.
  let meters = null
  let metersAt = 0
  let meterSub = null

  socket.on('message', (msg, rinfo) => {
    try {
      const decoded = decodeOscMessage(msg)
      if (decoded.address.startsWith('/meters')) {
        const blob = (decoded.args ?? []).find((a) => a.type === 'b')?.value
        if (blob) {
          meters = decodeXAirMeters(blob)
          metersAt = Date.now()
        }
        // Deliberately not stored in `state` or re-emitted: meters arrive many
        // times a second and would drown every other listener.
        return
      }
      if (Array.isArray(decoded.args) && decoded.args.length > 0) state.set(decoded.address, decoded.args)
      events.emit('message', { ...decoded, remote: { address: rinfo.address, port: rinfo.port } })
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
    /**
     * Ask the desk to identify itself, and WAIT for the answer.
     *
     * This is the only thing that proves a connection. `open()` resolves when a
     * local UDP socket binds, which succeeds for any address you can type —
     * UDP is connectionless, so nothing has been contacted at that point. Typing
     * a wrong IP therefore reported "Connected", and you would find out at the
     * venue when a fader did nothing.
     *
     * The XR18 answers `/xinfo` with four strings: its address, its name, the
     * model, and the firmware. Getting them back means the desk is really there
     * AND is really an X-Air desk — worth showing to the user rather than a
     * green dot with nothing behind it.
     *
     * Resolves `null` on timeout. A timeout is not an error: the most common
     * cause is the wrong IP or the wrong network, both of which the caller
     * explains far better than a thrown exception.
     */
    identify(timeoutMs = XAIR_IDENTIFY_TIMEOUT_MS) {
      return new Promise((resolve) => {
        let done = false
        const finish = (value) => {
          if (done) return
          done = true
          clearTimeout(timer)
          events.off('message', onMessage)
          resolve(value)
        }
        const onMessage = (m) => {
          if (m.address !== '/xinfo') return
          const s = (m.args ?? []).filter((a) => a.type === 's').map((a) => a.value)
          finish({
            address: s[0] ?? null,
            name: s[1] ?? null,
            model: s[2] ?? null,
            firmware: s[3] ?? null,
          })
        }
        const timer = setTimeout(() => finish(null), timeoutMs)
        timer.unref?.()
        events.on('message', onMessage)
        send('/xinfo')
      })
    },
    /**
     * Start (or renew) the desk's metering feed.
     *
     * The subscription EXPIRES after about ten seconds, so it has to be renewed
     * or the levels simply stop with no error — which reads as "no signal" for a
     * perfectly good rig. A false red costs nearly as much as a false green, so
     * the age of the last frame is reported alongside it and the caller decides
     * whether to believe it.
     */
    subscribeMeters(renewMs = XAIR_METER_RENEW_MS) {
      const ask = () => send('/meters', [{ type: 's', value: '/meters/1' }])
      ask()
      if (meterSub) return
      meterSub = setInterval(ask, renewMs)
      meterSub.unref?.()
    },
    unsubscribeMeters() {
      if (meterSub) clearInterval(meterSub)
      meterSub = null
      meters = null
      metersAt = 0
    },
    /**
     * The last metering frame, with its age.
     *
     * `levels` is dB per meter point, in the desk's own order: 0-15 are channels
     * 1-16, 16-17 the aux returns, 18-21 the FX returns, 22-27 the six BUSES,
     * 28-29 the main L/R. Confirmed against a real XR18V2, which sends 40 values
     * in an 84-byte blob.
     */
    getMeters() {
      return { levels: meters, ageMs: metersAt ? Date.now() - metersAt : null }
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
    setChannelMainAssign(channel, on) {
      send(xairChannelMainAssignPath(channel), [{ type: 'i', value: on ? 1 : 0 }])
    },
    setBusFader(bus, value) {
      send(xairBusFaderPath(bus), [{ type: 'f', value: clamp01(value) }])
    },
    /** Send a bare-address query; the desk replies with the current value. */
    query(address) {
      send(address)
    },
    /**
     * Query every channel's `/mix/{lr,on,fader}`, wait for the UDP replies, and
     * return the parsed per-channel state — the read-back that proves FOH safety.
     */
    async refreshChannelState({ waitMs = 250 } = {}) {
      // 1..16 — `/ch/17` and `/ch/18` do not exist on an XR18, so asking for
      // them was 6 wasted packets per refresh on a link that demonstrably drops
      // some. The 17/18 strip is queried separately below.
      for (let ch = 1; ch <= XAIR_CHANNEL_COUNT; ch += 1) {
        send(xairChannelMainAssignPath(ch))
        send(xairChannelOnPath(ch))
        send(xairChannelFaderPath(ch))
      }
      for (const s of ['/mix/lr', '/mix/on', '/mix/fader']) send(xairAuxReturnPath(s))
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      return parseXAirChannelState(Object.fromEntries(state))
    },
    /**
     * Ask the desk for specific addresses and return only what it answered.
     *
     * READ-ONLY: an OSC message with no arguments is a query. Nothing is
     * changed. Addresses that do not answer are simply absent from the result,
     * which is the signal that BarBro asked in a dialect this firmware does not
     * speak — importantly NOT the same as "the setting is off".
     */
    async queryPaths(addresses, { waitMs = 300 } = {}) {
      const wanted = addresses.filter((a) => typeof a === 'string' && a.startsWith('/'))
      for (const a of wanted) {
        state.delete(a) // do not report a stale answer from an earlier query
        send(a)
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      const out = {}
      for (const a of wanted) {
        const args = state.get(a)
        if (args) out[a] = args
      }
      return out
    },
    getRawState() {
      return Object.fromEntries(state)
    },
    status() {
      return { connected, host: cleanHost, port: cleanPort }
    },
  }
}
