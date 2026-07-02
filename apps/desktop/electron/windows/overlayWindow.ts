import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

// Transparent, click-through, always-on-top caption overlay. It must never steal
// focus from the call app (focusable: false) and must sit above borderless-fullscreen
// windows ('screen-saver' level). Mouse events pass through except when the renderer
// asks for interactivity (hovering the drag grip) via overlay:set-interactive.
export function createOverlayWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(1000, Math.round(workArea.width * 0.6))
  const height = 190

  const win = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - 32,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }
  return win
}
