/**
 * Does REAL Chromium, on THIS machine, output four discrete channels?
 *
 * The gate the whole live rig stands on. Everything around it is known:
 * the device carries 18 channels (a 4-channel WAV lit four desk strips), and
 * the graph is right (proven in an OfflineAudioContext). What has never been
 * measured is Chromium driving the device with more than two — and when it was
 * switched on in the app, playback went silent.
 *
 * This is the same Chromium the desktop app runs, with the same audio stack, so
 * its answer is the app's answer. The verdict comes from the XR18's own meters,
 * read by the orchestrator — not from anything this process claims.
 */
const { app, BrowserWindow } = require('electron')

// Without this the AudioContext starts suspended and the whole run measures
// silence that has nothing to do with channel counts.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const SECONDS = Number(process.argv[2] || 8)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  await win.loadURL('data:text/html,<html><body>probe</body></html>')

  const result = await win.webContents.executeJavaScript(`(async () => {
    const facts = {}
    const ctx = new AudioContext()
    facts.maxChannelCount = ctx.destination.maxChannelCount
    facts.defaultChannelCount = ctx.destination.channelCount
    try { await ctx.resume() } catch (e) { facts.resumeThrew = String(e) }
    facts.state = ctx.state

    try {
      // EXACTLY four. Opening all 18 to use four is the prime suspect for the
      // silence this probe exists to explain, so it is not repeated here.
      ctx.destination.channelCount = 4
      ctx.destination.channelCountMode = 'explicit'
      ctx.destination.channelInterpretation = 'discrete'
      facts.channelCountAfterSet = ctx.destination.channelCount
    } catch (e) {
      facts.setThrew = String(e)
    }

    const merger = ctx.createChannelMerger(4)
    merger.connect(ctx.destination)
    // Distinct levels so the desk meters identify WHICH channel arrived where —
    // four identical tones would only prove "something arrived".
    const tones = [[0, 440, -12], [1, 660, -12], [2, 1000, -18], [3, 300, -24]]
    for (const [ch, freq, db] of tones) {
      const o = ctx.createOscillator()
      o.frequency.value = freq
      const g = ctx.createGain()
      g.gain.value = Math.pow(10, db / 20)
      o.connect(g)
      g.connect(merger, 0, ch)
      o.start()
    }

    const t0 = ctx.currentTime
    await new Promise((r) => setTimeout(r, ${SECONDS * 1000}))
    facts.clockAdvanced = +(ctx.currentTime - t0).toFixed(2)
    facts.stateAtEnd = ctx.state
    return facts
  })()`)

  console.log('PROBE_FACTS ' + JSON.stringify(result))
  app.exit(0)
})
