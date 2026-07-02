import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { join } from 'path'
import { Channels, CaptionEvent } from './ipc/channels'
import { findSttModel, SttManager } from './stt/sttManager'
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

app.whenReady().then(() => {
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
    stt.start(model)
    stt.connectPcm(event.sender)
    overlayWindow?.showInactive()
    return { ok: true }
  })

  ipcMain.handle(Channels.captionsStop, () => {
    stt.stop()
    return { ok: true }
  })

  ipcMain.on(Channels.overlaySetInteractive, (_event, interactive: boolean) => {
    overlayWindow?.setIgnoreMouseEvents(!interactive, { forward: true })
  })
})

app.on('window-all-closed', () => {
  stt.stop()
  app.quit()
})
