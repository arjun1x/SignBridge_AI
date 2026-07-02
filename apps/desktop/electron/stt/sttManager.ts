import { MessageChannelMain, utilityProcess, WebContents } from 'electron'
import type { UtilityProcess } from 'electron'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { CaptionEvent } from '../ipc/channels'

export interface SttModelPaths {
  dir: string
  encoder: string
  decoder: string
  joiner: string
  tokens: string
}

// Locate a sherpa-onnx streaming transducer model under resources/stt/<model-dir>/.
// Prefers int8-quantized encoder/joiner (faster on CPU) with the fp32 decoder,
// matching the layout of the official streaming-zipformer release tarballs.
export function findSttModel(resourcesDir: string): SttModelPaths | null {
  const sttRoot = join(resourcesDir, 'stt')
  if (!existsSync(sttRoot)) return null

  for (const entry of readdirSync(sttRoot)) {
    const dir = join(sttRoot, entry)
    if (!statSync(dir).isDirectory()) continue
    const files = readdirSync(dir)

    const pick = (prefix: string, preferInt8: boolean): string | null => {
      const candidates = files.filter((f) => f.startsWith(prefix) && f.endsWith('.onnx'))
      if (!candidates.length) return null
      const int8 = candidates.find((f) => f.endsWith('.int8.onnx'))
      const fp32 = candidates.find((f) => !f.endsWith('.int8.onnx'))
      return join(dir, (preferInt8 ? int8 ?? fp32 : fp32 ?? int8)!)
    }

    const encoder = pick('encoder', true)
    const decoder = pick('decoder', false)
    const joiner = pick('joiner', true)
    const tokens = files.includes('tokens.txt') ? join(dir, 'tokens.txt') : null
    if (encoder && decoder && joiner && tokens) return { dir, encoder, decoder, joiner, tokens }
  }
  return null
}

export class SttManager {
  private child: UtilityProcess | null = null

  constructor(private onEvent: (ev: CaptionEvent) => void) {}

  get running(): boolean {
    return this.child !== null
  }

  start(model: SttModelPaths): void {
    if (this.child) return
    this.child = utilityProcess.fork(join(__dirname, 'sttProcess.js'), [], {
      serviceName: 'signbridge-stt',
      stdio: 'pipe'
    })
    this.child.stdout?.on('data', (d) => console.log('[stt]', String(d).trimEnd()))
    this.child.stderr?.on('data', (d) => console.error('[stt!]', String(d).trimEnd()))
    this.child.on('message', (msg: CaptionEvent) => this.onEvent(msg))
    this.child.on('exit', (code) => {
      console.log('[stt] exited with code', code)
      this.child = null
      this.onEvent({ kind: 'state', running: false, text: code ? `STT process exited (${code})` : undefined, ts: Date.now() })
    })
    this.child.postMessage({ type: 'init', model })
    this.onEvent({ kind: 'state', running: true, ts: Date.now() })
  }

  // Hand the renderer a direct MessagePort into the STT process so PCM never
  // funnels through the main process per-chunk.
  connectPcm(wc: WebContents): void {
    if (!this.child) return
    const { port1, port2 } = new MessageChannelMain()
    this.child.postMessage({ type: 'pcm-port' }, [port2])
    wc.postMessage('captions:pcm-port', null, [port1])
  }

  stop(): void {
    if (!this.child) return
    this.child.postMessage({ type: 'shutdown' })
    const child = this.child
    this.child = null
    setTimeout(() => child.kill(), 1500)
  }
}
