import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import test from 'node:test'
import {
  clamp01,
  createXAirClient,
  decodeOscMessage,
  encodeOscMessage,
  xairChannelBusSendPath,
  xairChannelFaderPath,
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

test('XR18 path builders constrain channels and buses', () => {
  assert.equal(xairChannelFaderPath(1), '/ch/01/mix/fader')
  assert.equal(xairChannelFaderPath(18), '/ch/18/mix/fader')
  assert.equal(xairChannelOnPath(7), '/ch/07/mix/on')
  assert.equal(xairChannelBusSendPath(3, 2), '/ch/03/mix/02/level')
  assert.equal(xairMainFaderPath(), '/lr/mix/fader')

  assert.throws(() => xairChannelFaderPath(0), /channel/)
  assert.throws(() => xairChannelFaderPath(19), /channel/)
  assert.throws(() => xairChannelBusSendPath(1, 0), /bus/)
  assert.throws(() => xairChannelBusSendPath(1, 7), /bus/)
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
