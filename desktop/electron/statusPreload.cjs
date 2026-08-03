/**
 * The bridge between the status window and the sidecar.
 *
 * The status window is the app's face: it says which of the two modes BarBro
 * Desktop is in, and lets you switch. That switch has to reach the main
 * process, and IPC is the way to do it — deliberately NOT an HTTP endpoint on
 * the loopback server, because that server is reachable by any page in any
 * browser on this machine, and "open a window" is not something a website
 * should be able to make the sidecar do.
 *
 * CommonJS because preloads are, and `contextIsolation` stays on: the window
 * gets exactly these four functions and no access to Node.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('barbro', {
  /** Current mode + version + port. */
  getState: () => ipcRenderer.invoke('barbro:state'),
  /** Switch into offline mode: mount the app and open its window. */
  openOffline: () => ipcRenderer.invoke('barbro:open-offline'),
  /** Close the offline window. The sidecar keeps running either way. */
  closeOffline: () => ipcRenderer.invoke('barbro:close-offline'),
  /** Subscribe to mode changes; returns an unsubscribe function. */
  onState: (cb) => {
    const handler = (_event, state) => cb(state)
    ipcRenderer.on('barbro:state', handler)
    return () => ipcRenderer.removeListener('barbro:state', handler)
  },
})
