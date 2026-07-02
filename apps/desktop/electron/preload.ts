import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

interface CaptionEvent {
  kind: 'partial' | 'final' | 'state' | 'error'
  text?: string
  running?: boolean
  ts: number
}

const api = {
  getStatus: (): Promise<{ modelFound: boolean; modelDir: string | null; running: boolean }> =>
    ipcRenderer.invoke('captions:status'),

  startCaptions: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('captions:start'),

  stopCaptions: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('captions:stop'),

  onCaption: (cb: (ev: CaptionEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: CaptionEvent) => cb(ev)
    ipcRenderer.on('captions:event', listener)
    return () => ipcRenderer.removeListener('captions:event', listener)
  },

  setOverlayInteractive: (interactive: boolean): void => {
    ipcRenderer.send('overlay:set-interactive', interactive)
  }
}

contextBridge.exposeInMainWorld('signbridge', api)

// MessagePorts cannot cross the contextBridge; relay the PCM port into the main
// world via window.postMessage (the documented Electron pattern).
ipcRenderer.on('captions:pcm-port', (event) => {
  window.postMessage({ type: 'signbridge:pcm-port' }, '*', event.ports)
})

export type SignBridgeApi = typeof api
