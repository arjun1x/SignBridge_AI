// Runs inside utilityProcess.fork() — plain Node, no Electron renderer/main APIs
// beyond process.parentPort. Hosts the sherpa-onnx streaming recognizer so model
// load + decoding never block the UI. PCM arrives on a MessagePort wired directly
// from the renderer.
import { createRequire } from 'module'
import { dirname } from 'path'

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

function emit(ev: { kind: string; text?: string; running?: boolean; ts: number }): void {
  process.parentPort.postMessage(ev)
}

function init(model: SttModelPaths): void {
  try {
    // Windows: the sherpa-onnx DLLs live in the platform package; it must be on
    // PATH before the addon loads or require() fails with a Win32 error.
    try {
      const platformPkg = dirname(nodeRequire.resolve('sherpa-onnx-win-x64/package.json'))
      process.env.PATH = `${platformPkg};${process.env.PATH ?? ''}`
    } catch {
      // non-Windows or already resolvable
    }
    const sherpa = nodeRequire('sherpa-onnx-node')

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

process.parentPort.on('message', (e) => {
  const msg = e.data
  switch (msg?.type) {
    case 'init':
      init(msg.model)
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
