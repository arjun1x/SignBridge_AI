import { BrowserWindow } from 'electron'
import { join } from 'path'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 920,
    height: 680,
    title: 'SignBridge AI',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/index.html`)
  } else {
    // Served by the app:// protocol registered in main.ts (COOP/COEP headers).
    win.loadURL('app://bundle/index.html')
  }
  return win
}
