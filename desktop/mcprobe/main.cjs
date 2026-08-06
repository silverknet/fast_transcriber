// Does a REAL multichannel AudioContext actually output on this machine?
// The renderer returns its findings directly, so nothing depends on console
// plumbing (which changed shape between Electron versions).
const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  await w.loadURL('data:text/html,<html><body></body></html>')
  const info = await w.webContents.executeJavaScript(`(async () => {
    const ctx = new AudioContext({ latencyHint: 0 })
    await ctx.resume().catch(() => {})
    const out = { max: ctx.destination.maxChannelCount, state0: ctx.state, sr: ctx.sampleRate }
    try {
      ctx.destination.channelCount = ctx.destination.maxChannelCount
      ctx.destination.channelCountMode = 'explicit'
      ctx.destination.channelInterpretation = 'discrete'
      out.channelCountAfterSet = ctx.destination.channelCount
    } catch (e) { out.setError = String(e && e.message || e) }
    const merger = ctx.createChannelMerger(ctx.destination.channelCount)
    merger.connect(ctx.destination)
    const tone = (f, g, i) => {
      const o = ctx.createOscillator(); o.frequency.value = f
      const gn = ctx.createGain(); gn.gain.value = g
      o.connect(gn); gn.connect(merger, 0, i); o.start()
    }
    tone(440, 0.25, 0); tone(440, 0.25, 1); tone(1000, 0.12, 2); tone(300, 0.06, 3)
    const t0 = ctx.currentTime
    await new Promise(r => setTimeout(r, 8000))
    out.advanced = +(ctx.currentTime - t0).toFixed(2)
    out.state1 = ctx.state
    return out
  })()`)
  console.log('RESULT ' + JSON.stringify(info))
  app.quit()
})
