// Captures Windows loopback audio (all system sound) via getDisplayMedia — the
// main process auto-approves the request with audio: 'loopback'. The video track
// is required by the API but dropped immediately. An AudioWorklet downsamples to
// 16 kHz mono and chunks are posted straight to the STT utility process over a
// MessagePort handed to us by the main process.

let pcmPort: MessagePort | null = null
let ctx: AudioContext | null = null
let mediaStream: MediaStream | null = null

// Dev diagnostics, readable from the console as window.__sbDebug.
const debugState = {
  portReceived: false,
  chunksSent: 0,
  lastPeak: 0,
  ctxState: 'none' as string,
  trackLabel: '' as string,
  trackMuted: null as boolean | null,
  analyserPeak: 0,
  sendErrors: 0,
  lastSendError: '' as string
}
;(window as unknown as { __sbDebug: typeof debugState }).__sbDebug = debugState

// Must be called before startCapture so the port isn't missed. Idempotent:
// React StrictMode double-mounts effects, and a second listener on the same
// event would close the port the first one just adopted.
let listening = false
export function listenForPcmPort(): void {
  if (listening) return
  listening = true
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'signbridge:pcm-port' && e.ports[0]) {
      if (pcmPort === e.ports[0]) return
      pcmPort?.close()
      pcmPort = e.ports[0]
      pcmPort.start()
      debugState.portReceived = true
    }
  })
}

export async function startCapture(): Promise<void> {
  // Plain audio: true — audio-processing constraints on a loopback capture make
  // Chromium deliver silence on Windows. The video track must also stay alive:
  // stopping it before building the audio graph silences the loopback feed
  // (audio and video share one capture session). Nothing consumes the frames.
  mediaStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true
  })

  if (mediaStream.getAudioTracks().length === 0) {
    stopCapture()
    throw new Error('No system-audio track in capture — loopback audio unavailable')
  }

  const audioTrack = mediaStream.getAudioTracks()[0]
  debugState.trackLabel = audioTrack.label
  debugState.trackMuted = audioTrack.muted

  ctx = new AudioContext()
  await ctx.audioWorklet.addModule('pcm-worklet.js')
  const source = ctx.createMediaStreamSource(mediaStream)

  // Debug tap: analyser on the same source, sampled once a second.
  const analyser = ctx.createAnalyser()
  source.connect(analyser)
  const analyserBuf = new Float32Array(analyser.fftSize)
  const analyserTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(analyserBuf)
    for (const v of analyserBuf) {
      if (Math.abs(v) > debugState.analyserPeak) debugState.analyserPeak = Math.abs(v)
    }
    if (!ctx) clearInterval(analyserTimer)
  }, 250)
  const node = new AudioWorkletNode(ctx, 'pcm-processor', {
    processorOptions: { targetSampleRate: 16000, chunkMs: 100 }
  })
  node.port.onmessage = (e: MessageEvent) => {
    const { samples, sampleRate } = e.data
    for (let i = 0; i < samples.length; i += 16) {
      if (Math.abs(samples[i]) > debugState.lastPeak) debugState.lastPeak = Math.abs(samples[i])
    }
    debugState.chunksSent++
    debugState.ctxState = ctx?.state ?? 'none'
    try {
      // Structured clone, no transfer list: ArrayBuffer transfer across
      // Electron's remoted renderer↔utility MessagePort delivers `undefined`.
      pcmPort?.postMessage({ samples, sampleRate })
    } catch (err) {
      debugState.sendErrors++
      debugState.lastSendError = String(err)
    }
  }
  source.connect(node)
  // Deliberately not connected to ctx.destination: the audio is already playing
  // through the user's speakers; re-outputting it would double it.
}

export function stopCapture(): void {
  mediaStream?.getTracks().forEach((t) => t.stop())
  mediaStream = null
  ctx?.close()
  ctx = null
}

export function isCapturing(): boolean {
  return mediaStream !== null
}
