// Runs inside utilityProcess.fork() — plain Node, no Electron renderer/main APIs
// beyond process.parentPort. Hosts the sherpa-onnx speech engines (streaming
// STT recognizer + Piper offline TTS) so model load + inference never block
// the UI. STT PCM arrives on a MessagePort wired directly from the renderer;
// TTS requests/replies go through parentPort (main relays to the renderer).
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

interface SttModelPaths {
  dir: string
  encoder: string
  decoder: string
  joiner: string
  tokens: string
}

const nodeRequire = createRequire(__filename)

// parentPort/MessagePort listeners do NOT keep the Node event loop alive in a
// utility process — without this the process exits with code 0 immediately.
setInterval(() => {}, 1 << 30)

let recognizer: any = null
let stream: any = null
let lastPartial = ''
let tts: any = null

function loadSherpa(): any {
  // Windows: the sherpa-onnx DLLs live in the platform package; it must be on
  // PATH before the addon loads or require() fails with a Win32 error.
  try {
    const platformPkg = dirname(nodeRequire.resolve('sherpa-onnx-win-x64/package.json'))
    process.env.PATH = `${platformPkg};${process.env.PATH ?? ''}`
  } catch {
    // non-Windows or already resolvable
  }
  return nodeRequire('sherpa-onnx-node')
}

function emit(ev: { kind: string; text?: string; running?: boolean; ts: number }): void {
  process.parentPort.postMessage(ev)
}

function init(model: SttModelPaths): void {
  try {
    const sherpa = loadSherpa()

    recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: model.encoder,
          decoder: model.decoder,
          joiner: model.joiner
        },
        tokens: model.tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      },
      decodingMethod: 'greedy_search',
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20
    })
    stream = recognizer.createStream()
    console.log('[init] STT model loaded from', model.dir)
    emit({ kind: 'state', running: true, text: 'STT model loaded', ts: Date.now() })
  } catch (err) {
    console.error('[init] failed:', err)
    emit({ kind: 'error', text: `Failed to load STT model: ${String(err)}`, ts: Date.now() })
  }
}

let pcmCount = 0

function acceptPcm(msg: { samples: Float32Array | ArrayBuffer; sampleRate: number }): void {
  if (pcmCount === 0) {
    console.log('[pcm] first chunk:', Object.prototype.toString.call(msg?.samples), 'rate', msg?.sampleRate)
  }
  pcmCount++
  if (pcmCount % 100 === 0) console.log(`[pcm] ${pcmCount} chunks received`)
  if (!recognizer || !stream || !msg?.samples) return
  const samples =
    msg.samples instanceof Float32Array ? msg.samples : new Float32Array(msg.samples as ArrayBuffer)
  stream.acceptWaveform({ samples, sampleRate: msg.sampleRate })

  while (recognizer.isReady(stream)) recognizer.decode(stream)

  const text: string = recognizer.getResult(stream).text.trim()
  if (recognizer.isEndpoint(stream)) {
    if (text) emit({ kind: 'final', text, ts: Date.now() })
    lastPartial = ''
    recognizer.reset(stream)
  } else if (text && text !== lastPartial) {
    lastPartial = text
    emit({ kind: 'partial', text, ts: Date.now() })
  }
}

function initTts(modelDir: string): void {
  try {
    const sherpa = loadSherpa()
    const files = nodeRequire('fs').readdirSync(modelDir) as string[]
    const onnx = files.find((f) => f.endsWith('.onnx'))
    if (!onnx) throw new Error(`no .onnx voice in ${modelDir}`)

    tts = new sherpa.OfflineTts({
      model: {
        vits: {
          model: join(modelDir, onnx),
          tokens: join(modelDir, 'tokens.txt'),
          dataDir: existsSync(join(modelDir, 'espeak-ng-data'))
            ? join(modelDir, 'espeak-ng-data')
            : ''
        },
        numThreads: 1,
        provider: 'cpu',
        debug: 0
      },
      maxNumSentences: 1
    })
    console.log('[tts] voice loaded from', modelDir)
    process.parentPort.postMessage({ kind: 'tts-state', ready: true, ts: Date.now() })
  } catch (err) {
    console.error('[tts] init failed:', err)
    process.parentPort.postMessage({ kind: 'tts-state', ready: false, text: String(err), ts: Date.now() })
  }
}

function generateTts(id: number, text: string, speed: number): void {
  try {
    if (!tts) throw new Error('TTS voice not loaded')
    // enableExternalBuffer: false — Electron's memory-caged V8 forbids
    // napi external ArrayBuffers, so the addon must copy its output into a
    // normal V8 buffer or generate() throws "External buffers are not
    // allowed". (No transfer list on the post — see the week-1 port lesson.)
    const audio = tts.generate({ text, sid: 0, speed, enableExternalBuffer: false })
    process.parentPort.postMessage({
      kind: 'tts-result',
      id,
      samples: audio.samples,
      sampleRate: audio.sampleRate,
      ts: Date.now()
    })
  } catch (err) {
    process.parentPort.postMessage({ kind: 'tts-result', id, error: String(err), ts: Date.now() })
  }
}

process.parentPort.on('message', (e) => {
  const msg = e.data
  switch (msg?.type) {
    case 'init':
      init(msg.model)
      break
    case 'init-tts':
      initTts(msg.modelDir)
      break
    case 'tts':
      generateTts(msg.id, msg.text, msg.speed ?? 1.0)
      break
    case 'pcm-port': {
      const port = e.ports[0]
      console.log('[pcm] port received:', port ? 'ok' : 'MISSING')
      port.on('message', (pcmEvent) => acceptPcm(pcmEvent.data))
      port.start()
      break
    }
    case 'shutdown':
      process.exit(0)
  }
})
