import { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, session } from 'electron'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { Channels, CaptionEvent } from './ipc/channels'
import { findSttModel, findTtsModel, SttManager } from './stt/sttManager'
import { createMainWindow } from './windows/mainWindow'
import { createOverlayWindow } from './windows/overlayWindow'

const resourcesDir = app.isPackaged
  ? process.resourcesPath
  : join(app.getAppPath(), 'resources')

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

function broadcast(ev: CaptionEvent): void {
  for (const win of [mainWindow, overlayWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(Channels.captionsEvent, ev)
  }
}

const stt = new SttManager(broadcast)

// Packaged builds serve the renderer over app:// instead of file:// so we can
// attach COOP/COEP headers (cross-origin isolation -> SharedArrayBuffer ->
// onnxruntime-web WASM threads) and so absolute asset paths (/models/...,
// /ort/..., /mediapipe/...) resolve. Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

function registerAppProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer')
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    const target = normalize(join(rendererRoot, pathname === '/' ? '/index.html' : pathname))
    if (!target.startsWith(rendererRoot)) {
      return new Response('forbidden', { status: 403 })
    }
    const res = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(res.headers)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    return new Response(res.body, { status: res.status, headers })
  })
}

app.whenReady().then(() => {
  if (app.isPackaged) registerAppProtocol()
  // Auto-approve getDisplayMedia with WASAPI loopback audio (all system audio).
  // The renderer immediately drops the video track — we only want the sound.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' })
      })
    },
    { useSystemPicker: false }
  )

  mainWindow = createMainWindow()
  overlayWindow = createOverlayWindow()

  // Load the routable TTS voice (Piper via sherpa) if it's been downloaded.
  const ttsModelDir = findTtsModel(resourcesDir)
  if (ttsModelDir) stt.initTts(ttsModelDir)

  mainWindow.on('closed', () => {
    mainWindow = null
    overlayWindow?.close()
  })
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  ipcMain.handle(Channels.captionsStatus, () => {
    const model = findSttModel(resourcesDir)
    return { modelFound: model !== null, modelDir: model?.dir ?? null, running: stt.running }
  })

  ipcMain.handle(Channels.captionsStart, (event) => {
    const model = findSttModel(resourcesDir)
    if (!model) {
      return {
        ok: false,
        error: 'STT model not found. Run "npm run download:stt" from the repo root, then try again.'
      }
    }
    stt.startStt(model)
    stt.connectPcm(event.sender)
    overlayWindow?.showInactive()
    return { ok: true }
  })

  ipcMain.handle(Channels.captionsStop, () => {
    stt.stopStt()
    return { ok: true }
  })

  ipcMain.handle('tts:status', () => ({
    modelFound: findTtsModel(resourcesDir) !== null,
    ready: stt.ttsAvailable
  }))

  ipcMain.handle('tts:speak', async (_event, text: string, speed?: number) => {
    let audio
    try {
      audio = await stt.speak(text, speed)
    } catch (err) {
      throw new Error(`SPEAK-REJECTED: ${String(err)}`)
    }
    return { samples: audio.samples, sampleRate: audio.sampleRate }
  })

  ipcMain.on(Channels.overlaySetInteractive, (_event, interactive: boolean) => {
    overlayWindow?.setIgnoreMouseEvents(!interactive, { forward: true })
  })
})

app.on('window-all-closed', () => {
  stt.shutdown()
  app.quit()
})
