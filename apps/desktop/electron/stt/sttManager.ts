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

// Locate a sherpa-onnx Piper voice under resources/tts/<voice-dir>/.
export function findTtsModel(resourcesDir: string): string | null {
  const ttsRoot = join(resourcesDir, 'tts')
  if (!existsSync(ttsRoot)) return null
  for (const entry of readdirSync(ttsRoot)) {
    const dir = join(ttsRoot, entry)
    if (!statSync(dir).isDirectory()) continue
    const files = readdirSync(dir)
    if (files.includes('tokens.txt') && files.some((f) => f.endsWith('.onnx'))) return dir
  }
  return null
}

export interface TtsAudio {
  samples: Float32Array
  sampleRate: number
}

// One utility process hosts both sherpa engines. Lifecycles are independent:
// STT activates with captions; TTS loads once a voice model exists. The
// child stays alive until app shutdown (killing it on caption stop would
// also kill the loaded TTS voice).
export class SttManager {
  private child: UtilityProcess | null = null
  private sttInitialized = false
  private sttActive = false
  private ttsInitialized = false
  private ttsReady = false
  private ttsSeq = 0
  private ttsPending = new Map<
    number,
    { resolve: (audio: TtsAudio) => void; reject: (err: Error) => void }
  >()

  constructor(private onEvent: (ev: CaptionEvent) => void) {}

  get running(): boolean {
    return this.sttActive
  }

  get ttsAvailable(): boolean {
    return this.ttsReady
  }

  private ensure(): UtilityProcess {
    if (this.child) return this.child
    this.child = utilityProcess.fork(join(__dirname, 'sttProcess.js'), [], {
      serviceName: 'signbridge-speech',
      stdio: 'pipe'
    })
    this.child.stdout?.on('data', (d) => console.log('[stt]', String(d).trimEnd()))
    this.child.stderr?.on('data', (d) => console.error('[stt!]', String(d).trimEnd()))
    this.child.on('message', (msg: any) => {
      if (msg?.kind === 'tts-result') {
        const pending = this.ttsPending.get(msg.id)
        if (pending) {
          this.ttsPending.delete(msg.id)
          if (msg.error) pending.reject(new Error(msg.error))
          else {
            // Always copy: arrays deserialized from utility-process messages
            // can be backed by external memory, which ipcMain.handle refuses
            // to serialize back to the renderer ("External buffers are not
            // allowed"). A fresh Float32Array is V8-owned and passes. The
            // utility may also have downgraded to a plain number array.
            const samples = new Float32Array(msg.samples)
            pending.resolve({ samples, sampleRate: msg.sampleRate })
          }
        }
        return
      }
      if (msg?.kind === 'tts-state') {
        this.ttsReady = msg.ready === true
        if (!msg.ready && msg.text) console.error('[tts] init failed:', msg.text)
        return
      }
      this.onEvent(msg as CaptionEvent)
    })
    this.child.on('exit', (code) => {
      console.log('[stt] exited with code', code)
      this.child = null
      this.sttInitialized = false
      this.sttActive = false
      this.ttsInitialized = false
      this.ttsReady = false
      for (const pending of this.ttsPending.values()) {
        pending.reject(new Error('speech process exited'))
      }
      this.ttsPending.clear()
      this.onEvent({ kind: 'state', running: false, text: code ? `speech process exited (${code})` : undefined, ts: Date.now() })
    })
    return this.child
  }

  startStt(model: SttModelPaths): void {
    const child = this.ensure()
    if (!this.sttInitialized) {
      this.sttInitialized = true
      child.postMessage({ type: 'init', model })
    }
    this.sttActive = true
    this.onEvent({ kind: 'state', running: true, ts: Date.now() })
  }

  // Captions stopped: the renderer stops sending PCM; the child stays up so
  // the TTS voice survives.
  stopStt(): void {
    this.sttActive = false
  }

  initTts(modelDir: string): void {
    const child = this.ensure()
    if (this.ttsInitialized) return
    this.ttsInitialized = true
    child.postMessage({ type: 'init-tts', modelDir })
  }

  speak(text: string, speed = 1.0): Promise<TtsAudio> {
    const child = this.ensure()
    const id = ++this.ttsSeq
    return new Promise<TtsAudio>((resolve, reject) => {
      this.ttsPending.set(id, { resolve, reject })
      try {
        child.postMessage({ type: 'tts', id, text, speed })
      } catch (err) {
        this.ttsPending.delete(id)
        reject(new Error(`REQUEST-POST: ${String(err)}`))
        return
      }
      setTimeout(() => {
        if (this.ttsPending.delete(id)) reject(new Error('TTS timed out'))
      }, 30_000)
    })
  }

  // Hand the renderer a direct MessagePort into the STT process so PCM never
  // funnels through the main process per-chunk.
  connectPcm(wc: WebContents): void {
    if (!this.child) return
    const { port1, port2 } = new MessageChannelMain()
    this.child.postMessage({ type: 'pcm-port' }, [port2])
    wc.postMessage('captions:pcm-port', null, [port1])
  }

  shutdown(): void {
    if (!this.child) return
    this.child.postMessage({ type: 'shutdown' })
    const child = this.child
    this.child = null
    setTimeout(() => child.kill(), 1500)
  }
}
