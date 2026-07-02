import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// COOP/COEP make the renderer cross-origin isolated so onnxruntime-web can use
// SharedArrayBuffer (WASM threads) when the sign-recognition worker lands in week 2.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          sttProcess: resolve(__dirname, 'electron/stt/sttProcess.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    server: {
      headers: isolationHeaders
    },
    preview: {
      headers: isolationHeaders
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html'),
          overlay: resolve(__dirname, 'src/overlay.html')
        }
      }
    }
  }
})
