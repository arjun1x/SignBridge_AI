import { assetUrl } from './assets'
import { GlossDebouncer, DEFAULT_DEBOUNCE, type DebounceConfig } from '../inference/debounce'
import { LetterCommitter } from '../inference/letterCommitter'
import { SentenceAssembler } from '../nlp/sentenceAssembler'
import SignWorker from '../inference/signWorker?worker'
import type { ModelInfo, SignMode, WorkerReply, WorkerRequest, Prediction } from '../inference/protocol'
export type { ModelInfo, SignMode } from '../inference/protocol'
export { FRAME_FEATURE_DIM } from './features'

export interface SignPipelineStatus {
  handsPresent: boolean; motionEnergy: number; isResting: boolean; fps: number
  latencyMs: number; landmarkMs: number; inferenceMs: number; skippedFrames: number; backend: string
}
export interface FingerspellState {
  letter: string; prob: number; word: string; available: boolean; uncertain: boolean
}
export interface SignPipelineCallbacks {
  onStatus?: (s: SignPipelineStatus) => void
  onPrediction?: (p: { gloss: string; prob: number; ts: number }) => void
  onGlossBuffer?: (glosses: string[]) => void
  onSentence?: (sentence: string) => void
  onError?: (message: string) => void
  onReady?: (model: ModelInfo) => void
  onState?: (state: 'idle' | 'loading' | 'running') => void
  onFingerspell?: (s: FingerspellState) => void
  onLandmarks?: (hands: number[][]) => void
}
export interface SignPipelineOptions {
  debounce?: DebounceConfig; autoSpeak?: boolean; autoSpeakAfterMs?: number; mode?: SignMode
}
let active: Pipeline | null = null
let selectedMode: SignMode = 'fingerspell'

async function resolveModel(mode: SignMode): Promise<{ base: string; labelsUrl: string }> {
  const names = mode === 'fingerspell' ? ['fingerspell_v2', 'fingerspell_v1'] : ['signs_v2', 'signs_v1']
  for (const name of names) {
    const response = await fetch(assetUrl(`/models/${name}.meta.json`)).catch(() => null)
    if (!response?.ok) continue
    let meta: Record<string, unknown>
    try { meta = await response.json() } catch { continue } // dev-server HTML fallback is not metadata
    if (meta.val_acc == null) continue
    const labelFile = typeof meta.labels_file === 'string' && /^[\w.-]+\.json$/.test(meta.labels_file)
      ? meta.labels_file : mode === 'fingerspell' ? 'labels_fingerspell.json' : 'labels.json'
    return { base: assetUrl(`/models/${name}`), labelsUrl: assetUrl(`/models/${labelFile}`) }
  }
  throw new Error(`The ${mode === 'fingerspell' ? 'fingerspelling' : 'sign'} model is not installed. Sync a trained ONNX model using the setup guide, then try again.`)
}

class Pipeline {
  private stopped = false
  private stream: MediaStream | null = null
  private worker: Worker | null = null
  private cancelLoad: (() => void) | null = null
  private frameHandle: number | null = null
  private usingVideoCallback = false
  private inFlight = false
  private ready = false
  private version = 0
  private lastVideoTime = -1
  private lastSent = -Infinity
  private frameStarted = 0
  private skipped = 0
  private frames = 0
  private fps = 0
  private fpsStart = performance.now()
  private lastUi = -Infinity
  private backend = ''
  private absentSince: number | null = null
  private committer = new LetterCommitter()
  private debouncer: GlossDebouncer
  private assembler: SentenceAssembler
  private word = ''
  private lastLetter: Prediction | undefined
  constructor(private video: HTMLVideoElement, private cb: SignPipelineCallbacks,
    private options: SignPipelineOptions, private mode: SignMode) {
    this.debouncer = new GlossDebouncer(options.debounce ?? DEFAULT_DEBOUNCE)
    this.assembler = new SentenceAssembler({ onBufferChange: (g) => cb.onGlossBuffer?.(g),
      onSentence: (s) => cb.onSentence?.(s) }, options.autoSpeak ?? false, options.autoSpeakAfterMs ?? 1600)
  }
  async start(): Promise<boolean> {
    this.cb.onState?.('loading')
    try {
      await this.load(this.mode)
      if (this.stopped) return false
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 30 }, facingMode: 'user' }, audio: false
      })
      if (this.stopped) { stream.getTracks().forEach((t) => t.stop()); return false }
      this.stream = stream; this.video.srcObject = stream
      await this.video.play()
      if (this.stopped) return false
      stream.getVideoTracks()[0].addEventListener('ended', this.cameraEnded)
      document.addEventListener('visibilitychange', this.visibilityChanged)
      this.cb.onState?.('running'); this.schedule()
      return true
    } catch (err) {
      if (!this.stopped) { this.cb.onError?.(String(err)); this.stop() }
      return false
    }
  }
  private cameraEnded = (): void => { this.cb.onError?.('Camera disconnected. Reconnect it and try again.'); this.stop() }
  private visibilityChanged = (): void => {
    this.committer.reset(); this.debouncer.reset(); this.lastLetter = undefined
    this.absentSince = null; this.assembler.updateRest(false, performance.now())
    this.cb.onLandmarks?.([]); this.emitLetter()
  }
  private async load(mode: SignMode): Promise<void> {
    this.ready = false; this.inFlight = false; this.version++
    this.cancelLoad?.(); this.worker?.terminate(); this.worker = null
    const version = this.version
    const model = await resolveModel(mode)
    if (this.stopped || version !== this.version) throw new Error('Recognition start cancelled')
    const worker = new SignWorker(); this.worker = worker
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Model loading timed out. Check the model files and restart.')), 60000)
      const cancel = () => { clearTimeout(timer); reject(new Error('Recognition start cancelled')) }
      this.cancelLoad = cancel
      worker.onerror = (event) => {
        clearTimeout(timer)
        if (!this.ready) reject(new Error(event.message || 'Recognition worker failed'))
        else { this.cb.onError?.(event.message || 'Recognition worker failed'); this.stop() }
      }
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (this.stopped || this.worker !== worker) return
        const msg = event.data
        if (msg.type === 'ready') {
          clearTimeout(timer); this.cancelLoad = null; this.ready = true
          this.backend = msg.backend; this.cb.onReady?.(msg.model); this.emitLetter(); resolve()
        } else if (msg.type === 'error') {
          clearTimeout(timer)
          if (!this.ready) reject(new Error(msg.message))
          else { this.cb.onError?.(msg.message); this.stop() }
        } else {
          this.inFlight = false
          if (!document.hidden) this.receive(msg)
        }
      }
      const request: WorkerRequest = { type: 'load', mode, ...model }
      worker.postMessage(request)
    })
  }
  async switchMode(mode: SignMode): Promise<boolean> {
    if (mode === this.mode || this.stopped) return !this.stopped
    this.commitWord(); this.mode = mode; this.committer.reset(); this.debouncer.reset()
    this.lastLetter = undefined; this.absentSince = null; this.cb.onLandmarks?.([])
    this.assembler.updateRest(false, performance.now()); this.cb.onState?.('loading')
    try { await this.load(mode); if (this.stopped) return false; this.cb.onState?.('running'); return true }
    catch (err) { if (!this.stopped) this.cb.onError?.(String(err)); this.stop(); return false }
  }
  private schedule = (): void => {
    if (this.stopped) return
    if ('requestVideoFrameCallback' in this.video) {
      this.usingVideoCallback = true
      this.frameHandle = this.video.requestVideoFrameCallback(this.tick)
    } else this.frameHandle = requestAnimationFrame(this.tick)
  }
  private tick = (): void => {
    this.schedule()
    const now = performance.now()
    if (this.inFlight && now - this.frameStarted > 10000) {
      this.cb.onError?.('Recognition stopped responding. Restart the camera.'); this.stop(); return
    }
    if (!this.ready || document.hidden || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return
    this.lastVideoTime = this.video.currentTime
    if (this.inFlight || now - this.lastSent < 30) { this.skipped++; return }
    const version = this.version
    this.inFlight = true; this.frameStarted = now; this.lastSent = now
    void createImageBitmap(this.video).then((bitmap) => {
      if (this.stopped || version !== this.version || !this.worker) { bitmap.close(); return }
      const msg: WorkerRequest = { type: 'frame', bitmap, capturedAt: now }
      this.worker.postMessage(msg, [bitmap])
    }).catch((err) => {
      if (!this.stopped && version === this.version) { this.cb.onError?.(String(err)); this.stop() }
    })
  }
  private receive(msg: Extract<WorkerReply, { type: 'frame' }>): void {
    const now = performance.now()
    this.frames++
    if (now - this.fpsStart >= 1000) { this.fps = this.frames * 1000 / (now - this.fpsStart); this.frames = 0; this.fpsStart = now }
    // Never let a stalled frame append old text after a newer pose/pause.
    if (now - msg.capturedAt > 500) {
      this.committer.reset(); this.debouncer.reset(); this.lastLetter = undefined
      this.absentSince = null; this.assembler.updateRest(false, now)
      this.cb.onLandmarks?.([]); this.emitLetter(); return
    }
    if (!msg.handsPresent) this.absentSince ??= msg.capturedAt
    else this.absentSince = null
    const handsAway = this.absentSince !== null && msg.capturedAt - this.absentSince >= 700
    if (handsAway) { this.commitWord(); this.debouncer.onRest() }
    if (this.mode === 'fingerspell') {
      this.lastLetter = msg.prediction
      if (!msg.handsPresent) this.committer.onHandLost(msg.capturedAt)
      if (msg.prediction) {
        const p = msg.prediction
        const letter = this.committer.push(p.label, p.prob, p.ts, p.margin)
        if (letter === 'space') this.commitWord()
        else if (letter === 'del') this.backspace()
        else if (letter) { this.word += letter.toLowerCase(); this.emitLetter() }
      }
    } else if (msg.prediction) {
      const p = msg.prediction
      this.cb.onPrediction?.({ gloss: p.label, prob: p.prob, ts: p.ts })
      const gloss = this.debouncer.push({ gloss: p.label, prob: p.prob, ts: p.ts })
      if (gloss) this.assembler.addGloss(gloss)
    }
    // A held letter is NOT a word boundary. Only hands-away pauses auto-speak.
    this.assembler.updateRest(handsAway, msg.capturedAt)
    this.cb.onLandmarks?.(msg.hands)
    if (now - this.lastUi >= 100) {
      this.lastUi = now; this.emitLetter()
      this.cb.onStatus?.({ handsPresent: msg.handsPresent, motionEnergy: msg.motionEnergy, isResting: handsAway,
        fps: this.fps, latencyMs: now - msg.capturedAt, landmarkMs: msg.landmarkMs,
        inferenceMs: msg.inferenceMs, skippedFrames: this.skipped, backend: this.backend })
    }
  }
  private emitLetter(): void {
    const p = this.lastLetter
    this.cb.onFingerspell?.({ letter: p?.label ?? '', prob: p?.prob ?? 0, word: this.word,
      available: this.ready && this.mode === 'fingerspell',
      uncertain: !p || p.prob < 0.72 || p.margin < 0.18 || ['J', 'Z', 'nothing'].includes(p.label) })
  }
  commitWord(): void { if (this.word) { this.assembler.addGloss(this.word); this.word = ''; this.emitLetter() } }
  speak(): void { this.commitWord(); this.assembler.speak() }
  backspace(): void { if (this.word) this.word = this.word.slice(0, -1); else this.assembler.backspace(); this.emitLetter() }
  clear(): void { this.word = ''; this.assembler.clear(); this.committer.reset(); this.emitLetter() }
  appendLetter(letter: string): void { if (/^[A-Z]$/.test(letter) && this.mode === 'fingerspell') { this.word += letter.toLowerCase(); this.emitLetter() } }
  setAutoSpeak(enabled: boolean): void { this.assembler.setAutoSpeak(enabled) }
  stop(): void {
    if (this.stopped) return
    this.stopped = true; this.version++; this.ready = false
    this.cancelLoad?.(); this.cancelLoad = null
    if (this.frameHandle !== null) {
      if (this.usingVideoCallback) this.video.cancelVideoFrameCallback(this.frameHandle)
      else cancelAnimationFrame(this.frameHandle)
    }
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    this.stream?.getVideoTracks().forEach((t) => t.removeEventListener('ended', this.cameraEnded))
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.video.srcObject === this.stream) this.video.srcObject = null
    this.stream = null; this.worker?.terminate(); this.worker = null
    if (active === this) active = null
    this.cb.onLandmarks?.([]); this.cb.onState?.('idle')
  }
}
export async function startSignPipeline(video: HTMLVideoElement, callbacks: SignPipelineCallbacks,
  options: SignPipelineOptions = {}): Promise<boolean> {
  active?.stop(); selectedMode = options.mode ?? selectedMode
  const pipeline = new Pipeline(video, callbacks, options, selectedMode); active = pipeline
  return pipeline.start()
}
export async function setSignMode(mode: SignMode): Promise<boolean> { selectedMode = mode; return active ? active.switchMode(mode) : true }
export function getSignMode(): SignMode { return selectedMode }
export function speakNow(): void { active?.speak() }
export function commitWord(): void { active?.commitWord() }
export function backspaceGloss(): void { active?.backspace() }
export function clearGlossBuffer(): void { active?.clear() }
export function setAutoSpeak(enabled: boolean): void { active?.setAutoSpeak(enabled) }
export function stopSignPipeline(): void { active?.stop() }
export function isSignPipelineRunning(): boolean { return active !== null }

export function appendLetter(letter: string): void { active?.appendLetter(letter) }
