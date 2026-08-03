import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import test from 'node:test'
import {
  clamp01,
  createXAirClient,
  decodeOscMessage,
  decodeXAirMeters,
  encodeOscString,
  XAIR_METER_FLOOR_DB,
  encodeOscMessage,
  parseXAirChannelState,
  xairBusFaderPath,
  xairChannelBusSendPath,
  xairChannelFaderPath,
  xairAuxReturnPath,
  xairChannelMainAssignPath,
  xairChannelUsbSourcePath,
  xairChannelUsbSwitchPath,
  xairChannelOnPath,
  xairMainFaderPath,
} from './xairOsc.mjs'

test('OSC message encoder/decoder round-trips common XR18 args', () => {
  const encoded = encodeOscMessage('/ch/01/mix/fader', [{ type: 'f', value: 0.75 }])
  const decoded = decodeOscMessage(encoded)

  assert.equal(decoded.address, '/ch/01/mix/fader')
  assert.equal(decoded.args.length, 1)
  assert.equal(decoded.args[0].type, 'f')
  assert.ok(Math.abs(decoded.args[0].value - 0.75) < 0.0001)
})

test('OSC encoder pads strings and supports mixed get/info style replies', () => {
  const decoded = decodeOscMessage(
    encodeOscMessage('/xinfo', [
      { type: 's', value: 'XR18' },
      { type: 'i', value: 18 },
      { type: 'f', value: 1.17 },
    ]),
  )

  assert.equal(decoded.address, '/xinfo')
  assert.deepEqual(decoded.args.map((a) => a.type), ['s', 'i', 'f'])
  assert.equal(decoded.args[0].value, 'XR18')
  assert.equal(decoded.args[1].value, 18)
  assert.ok(Math.abs(decoded.args[2].value - 1.17) < 0.0001)
})

/**
 * ADDRESSES VERIFIED AGAINST REAL HARDWARE — an XR18V2 on firmware 1.19.
 *
 * These were wrong, and wrong in the worst way: X-AIR ignores an address it does
 * not have, with no reply and no error, so every write to a made-up address
 * silently did nothing. `/ch/17` and `/ch/18` do not exist (the desk answers
 * `/ch/16` and stays silent above it), and bus masters are single-digit.
 *
 * Do not "tidy" these into consistency. The inconsistency is the desk's: channel
 * to bus SENDS are zero-padded, bus MASTERS are not. Both confirmed by query.
 */
test('XR18 path builders constrain channels and buses', () => {
  assert.equal(xairChannelFaderPath(1), '/ch/01/mix/fader')
  assert.equal(xairChannelFaderPath(16), '/ch/16/mix/fader')
  assert.equal(xairChannelOnPath(7), '/ch/07/mix/on')
  assert.equal(xairChannelBusSendPath(3, 2), '/ch/03/mix/02/level') // sends ARE padded
  assert.equal(xairMainFaderPath(), '/lr/mix/fader')

  assert.throws(() => xairChannelFaderPath(0), /channel/)
  // The regression this exists to prevent: 17 and 18 are not channels.
  assert.throws(() => xairChannelFaderPath(17), /channel/)
  assert.throws(() => xairChannelFaderPath(18), /channel/)
  assert.throws(() => xairChannelBusSendPath(1, 0), /bus/)
  assert.throws(() => xairChannelBusSendPath(1, 7), /bus/)
})

test('the 17/18 strip is the aux return, not channels', () => {
  assert.equal(xairAuxReturnPath('/mix/fader'), '/rtn/aux/mix/fader')
  assert.equal(xairAuxReturnPath('/mix/lr'), '/rtn/aux/mix/lr')
})

test('the USB switch and source addresses', () => {
  // `rtnsw` is the actual socket/USB switch; `rtnsrc` picks WHICH USB channel.
  // `insrc` is a different thing entirely — it selects an analog socket — and
  // mistaking one for the other cost an afternoon.
  assert.equal(xairChannelUsbSwitchPath(9), '/ch/09/preamp/rtnsw')
  assert.equal(xairChannelUsbSourcePath(9), '/ch/09/config/rtnsrc')
})

test('FOH-safety + monitor path builders', () => {
  assert.equal(xairChannelMainAssignPath(9), '/ch/09/mix/lr') // off-house control
  assert.equal(xairChannelMainAssignPath(16), '/ch/16/mix/lr')
  assert.equal(xairBusFaderPath(3), '/bus/3/mix/fader') // SINGLE digit — verified
  assert.throws(() => xairChannelMainAssignPath(19), /channel/)
  assert.throws(() => xairBusFaderPath(7), /bus/)
})

test('parseXAirChannelState decodes a desk readback (proves lr = off)', () => {
  const raw = {
    '/ch/09/mix/lr': [{ type: 'i', value: 0 }], // click: OFF the house
    '/ch/09/mix/on': [{ type: 'i', value: 1 }],
    '/ch/10/mix/lr': [{ type: 'i', value: 1 }], // music: ON the house
    '/ch/10/mix/fader': [{ type: 'f', value: 0.75 }],
    '/xinfo': [{ type: 's', value: 'XR18' }], // ignored (not a channel state)
  }
  const parsed = parseXAirChannelState(raw)
  assert.equal(parsed.channels[9].lr, 0)
  assert.equal(parsed.channels[9].on, 1)
  assert.equal(parsed.channels[10].lr, 1)
  assert.ok(Math.abs(parsed.channels[10].fader - 0.75) < 1e-6)
  assert.equal(parsed.channels['xinfo'], undefined)
})

test('client sends main-assign OFF over UDP and accumulates readback state', async () => {
  const server = dgram.createSocket('udp4')
  const received = []
  server.on('message', (msg, rinfo) => {
    const decoded = decodeOscMessage(msg)
    received.push(decoded)
    // Emulate the desk replying to a bare /ch/09/mix/lr query with value 0.
    if (decoded.address === '/ch/09/mix/lr' && decoded.args.length === 0) {
      server.send(encodeOscMessage('/ch/09/mix/lr', [{ type: 'i', value: 0 }]), rinfo.port, rinfo.address)
    }
  })
  await new Promise((resolve) => server.bind(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const client = createXAirClient({ host: '127.0.0.1', port, keepaliveMs: 60_000 })
  try {
    await client.open()
    await waitFor(() => received.some((m) => m.address === '/xremote'))

    client.setChannelMainAssign(9, false)
    await waitFor(() => received.some((m) => m.address === '/ch/09/mix/lr' && m.args[0]?.value === 0))

    const parsed = await client.refreshChannelState({ waitMs: 120 })
    assert.equal(parsed.channels[9].lr, 0) // read back OFF the house
  } finally {
    client.close()
    server.close()
  }
})

test('clamp01 protects live mixer writes', () => {
  assert.equal(clamp01(-0.5), 0)
  assert.equal(clamp01(0.5), 0.5)
  assert.equal(clamp01(2), 1)
  assert.equal(clamp01(Number.NaN), 0)
})

test('X AIR client sends xremote and clamped fader OSC over UDP', async () => {
  const server = dgram.createSocket('udp4')
  const received = []
  server.on('message', (msg) => received.push(decodeOscMessage(msg)))

  await new Promise((resolve) => server.bind(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')

  const client = createXAirClient({
    host: '127.0.0.1',
    port: address.port,
    keepaliveMs: 60_000,
  })

  try {
    await client.open()
    await waitFor(() => received.some((msg) => msg.address === '/xremote'))

    client.setChannelFader(1, 2)
    await waitFor(() => received.some((msg) => msg.address === '/ch/01/mix/fader'))
    const fader = received.find((msg) => msg.address === '/ch/01/mix/fader')
    assert.equal(fader.args[0].type, 'f')
    assert.ok(Math.abs(fader.args[0].value - 1) < 0.0001)
  } finally {
    client.close()
    server.close()
  }
})

function waitFor(predicate, timeoutMs = 500) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Timed out waiting for UDP OSC message'))
        return
      }
      setTimeout(tick, 10)
    }
    tick()
  })
}

/**
 * "CONNECTED" MUST MEAN THE DESK ANSWERED.
 *
 * `open()` resolves when a LOCAL UDP socket binds. UDP is connectionless, so
 * that succeeds for any address that parses — 1.2.3.4, a typo, a desk that is
 * switched off. The rig page therefore reported "Connected" for whatever you
 * typed, and you would discover the truth at a venue when a fader did nothing.
 *
 * `identify()` is the only thing that proves it: the desk answers `/xinfo` with
 * its address, name, model and firmware.
 */
test('identify() resolves null when nothing answers', async () => {
  // 198.51.100.x is TEST-NET-2 (RFC 5737) — guaranteed to route nowhere.
  const client = createXAirClient({ host: '198.51.100.9' })
  await client.open()
  const started = Date.now()
  const info = await client.identify(300)
  const took = Date.now() - started
  client.close()
  assert.equal(info, null, 'a desk that is not there must not report as identified')
  assert.ok(took >= 250 && took < 3000, `timed out in ${took}ms`)
})

test('identify() returns the desk’s own words when it answers', async () => {
  // A fake desk on loopback: bind a socket, reply to /xinfo like an XR18 does.
  const dgram = await import('node:dgram')
  const desk = dgram.createSocket('udp4')
  await new Promise((r) => desk.bind(0, '127.0.0.1', r))
  const deskPort = desk.address().port
  desk.on('message', (msg, rinfo) => {
    const { address } = decodeOscMessage(msg)
    if (address !== '/xinfo') return
    desk.send(
      encodeOscMessage('/xinfo', [
        { type: 's', value: '192.168.1.40' },
        { type: 's', value: 'XR18-BAND' },
        { type: 's', value: 'XR18' },
        { type: 's', value: '1.21' },
      ]),
      rinfo.port,
      rinfo.address,
    )
  })

  const client = createXAirClient({ host: '127.0.0.1', port: deskPort })
  await client.open()
  const info = await client.identify(2000)
  client.close()
  desk.close()

  assert.deepEqual(info, {
    address: '192.168.1.40',
    name: 'XR18-BAND',
    model: 'XR18',
    firmware: '1.21',
  })
})

test('identify() ignores other traffic while waiting', async () => {
  // A desk under /xremote streams meter and fader updates constantly. Resolving
  // on the first packet of any kind would make "connected" mean "something spoke",
  // which is not the same as "an X-Air desk identified itself".
  const dgram = await import('node:dgram')
  const desk = dgram.createSocket('udp4')
  await new Promise((r) => desk.bind(0, '127.0.0.1', r))
  const deskPort = desk.address().port
  desk.on('message', (msg, rinfo) => {
    const { address } = decodeOscMessage(msg)
    if (address !== '/xinfo') return
    // Noise first, the real answer second.
    desk.send(encodeOscMessage('/ch/01/mix/fader', [{ type: 'f', value: 0.5 }]), rinfo.port, rinfo.address)
    setTimeout(() => {
      desk.send(
        encodeOscMessage('/xinfo', [
          { type: 's', value: '192.168.1.40' },
          { type: 's', value: 'DESK' },
          { type: 's', value: 'XR18' },
          { type: 's', value: '1.21' },
        ]),
        rinfo.port,
        rinfo.address,
      )
    }, 20)
  })

  const client = createXAirClient({ host: '127.0.0.1', port: deskPort })
  await client.open()
  const info = await client.identify(2000)
  client.close()
  desk.close()
  assert.equal(info?.model, 'XR18')
})

// ── Metering ────────────────────────────────────────────────────────────────
//
// The desk's own meters are the only evidence that BarBro's audio actually
// ARRIVED on a channel. Before these, the decoder threw on the blob type tag,
// so every meter reply was dropped before anything could read it.

test('decodes a blob argument instead of throwing on its type tag', () => {
  const payload = Buffer.from([1, 2, 3, 4, 5])
  const size = Buffer.alloc(4)
  size.writeInt32BE(payload.length, 0)
  const msg = Buffer.concat([
    encodeOscString('/meters/1'),
    encodeOscString(',b'),
    size,
    payload,
    Buffer.alloc(3), // pad 5 -> 8
  ])
  const decoded = decodeOscMessage(msg)
  assert.equal(decoded.address, '/meters/1')
  assert.equal(decoded.args[0].type, 'b')
  assert.deepEqual([...decoded.args[0].value], [1, 2, 3, 4, 5])
})

test('blob padding is (n+3)&~3, so a 4-byte blob is NOT over-padded', () => {
  // (n+4)&~3 adds four bytes whenever the length is already a multiple of four,
  // which desynchronises everything after it — and is most packets.
  const payload = Buffer.from([9, 9, 9, 9])
  const size = Buffer.alloc(4)
  size.writeInt32BE(4, 0)
  const trailing = encodeOscString('after')
  const msg = Buffer.concat([
    encodeOscString('/x'),
    encodeOscString(',bs'),
    size,
    payload,
    trailing,
  ])
  const decoded = decodeOscMessage(msg)
  assert.deepEqual([...decoded.args[0].value], [9, 9, 9, 9])
  assert.equal(decoded.args[1].value, 'after')
})

test('meter values are little-endian dB x 256', () => {
  const blob = Buffer.alloc(4 + 3 * 2)
  blob.writeInt32LE(3, 0)
  blob.writeInt16LE(-12 * 256, 4) // -12.0 dB
  blob.writeInt16LE(-32768, 6) // the floor: true silence
  blob.writeInt16LE(-24.5 * 256, 8)
  assert.deepEqual(decodeXAirMeters(blob), [-12, XAIR_METER_FLOOR_DB, -24.5])
})

test('a truncated meter blob reports fewer channels, never invents silence', () => {
  // Silence and "no answer" must not look the same: one is a working channel
  // with nothing on it, the other is a rig that has told us nothing.
  const blob = Buffer.alloc(4 + 2)
  blob.writeInt32LE(8, 0) // claims eight
  blob.writeInt16LE(-6 * 256, 4) // supplies one
  assert.deepEqual(decodeXAirMeters(blob), [-6])
})

test('rubbish in gives an empty list, not a throw', () => {
  assert.deepEqual(decodeXAirMeters(Buffer.alloc(0)), [])
  assert.deepEqual(decodeXAirMeters(null), [])
})
