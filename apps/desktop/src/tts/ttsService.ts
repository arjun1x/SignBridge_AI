// TTS with two engines behind one speak() API:
//
//  - 'piper' (preferred when its voice model is downloaded): sherpa-onnx
//    Piper synthesis in the speech utility process returns raw PCM, played
//    here via an <audio> element — which supports setSinkId, so the voice
//    can be routed to a specific output device (VB-Cable Input -> the call
//    app hears it as a microphone). speechSynthesis cannot pick a device.
//  - 'system' (fallback): speechSynthesis with Windows voices.
//
// Speaking-state events drive the caption echo guard: when the voice plays
// on the DEFAULT output, the loopback caption capture would transcribe it,
// so captions are muted while speaking. When routed to VB-Cable the sound
// never reaches the loopback device — no muting needed, and the guard is
// skipped so captions keep flowing during simultaneous two-way use.
type SpeakingListener = (speaking: boolean, onDefaultOutput: boolean) => void

const listeners = new Set<SpeakingListener>()
const DEVICE_STORAGE_KEY = 'signbridge.ttsOutputDevice'
const MONITOR_STORAGE_KEY = 'signbridge.ttsLocalMonitor'
let queueDepth = 0
let speaking = false
let outputDeviceId = localStorage.getItem(DEVICE_STORAGE_KEY) ?? 'default'
let localMonitor = localStorage.getItem(MONITOR_STORAGE_KEY) !== 'off'
let piperReady = false

export function setTtsOutputDevice(deviceId: string): void {
  outputDeviceId = deviceId
  localStorage.setItem(DEVICE_STORAGE_KEY, deviceId)
}

/** When the voice is routed to a call device, also play a quiet local copy
 * so the signer knows what was said. */
export function setTtsLocalMonitor(enabled: boolean): void {
  localMonitor = enabled
  localStorage.setItem(MONITOR_STORAGE_KEY, enabled ? 'on' : 'off')
}

export function getTtsLocalMonitor(): boolean {
  return localMonitor
}

export function getTtsOutputDevice(): string {
  return outputDeviceId
}

export async function refreshTtsEngine(): Promise<'piper' | 'system'> {
  if (!window.signbridge) { piperReady = false; return 'system' }
  // The Piper voice loads asynchronously in the speech utility process at app
  // start. A status query that lands before it finishes would pin the whole
  // session to the system voice, which cannot be routed to a call device, so
  // keep polling briefly while the voice files exist but are not ready yet.
  for (let attempt = 0; attempt < 12; attempt++) {
    const status = await window.signbridge.ttsStatus().catch(() => ({ modelFound: false, ready: false }))
    piperReady = status.ready
    if (piperReady || !status.modelFound) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return piperReady ? 'piper' : 'system'
}

function setSpeaking(value: boolean): void {
  if (speaking === value) return
  speaking = value
  // The voice is audible on the default output (and could echo into the
  // caption loopback) when it plays there directly OR via the local monitor.
  const audibleOnDefault = outputDeviceId === 'default' || localMonitor
  for (const l of listeners) l(value, audibleOnDefault)
}

export function onSpeakingChange(listener: SpeakingListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isSpeaking(): boolean {
  return speaking
}

function pcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const pcm16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeStr = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + pcm16.byteLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, pcm16.byteLength, true)
  return new Blob([header, pcm16.buffer], { type: 'audio/wav' })
}

async function speakPiper(text: string, rate: number): Promise<void> {
  const { samples, sampleRate } = await window.signbridge.ttsSpeak(text, rate)
  const url = URL.createObjectURL(pcmToWavBlob(samples, sampleRate))
  try {
    const audio = new Audio(url)
    const routed = outputDeviceId !== 'default'
    if (routed) {
      await audio.setSinkId(outputDeviceId)
    }
    const players = [audio]
    if (routed && localMonitor) {
      // Quiet self-monitor on the default device: the call hears full volume
      // through the cable; the signer hears a soft local copy.
      const monitor = new Audio(url)
      monitor.volume = 0.4
      players.push(monitor)
    }
    await Promise.all(
      players.map(async (p) => {
        await p.play()
        await new Promise<void>((resolve) => {
          p.onended = () => resolve()
          p.onerror = () => resolve()
        })
      })
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

function speakSystem(text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    speechSynthesis.speak(utterance)
  })
}

export function speak(text: string, opts?: { rate?: number }): void {
  if (!text.trim()) return
  const rate = opts?.rate ?? 1.0

  queueDepth++
  setSpeaking(true)
  // Re-check lazily: the voice may have finished loading since the last status query.
  const engine = piperReady ? Promise.resolve<'piper' | 'system'>('piper') : refreshTtsEngine()
  const job = engine.then((e) => (e === 'piper' ? speakPiper(text, rate) : speakSystem(text, rate)))
  job
    .catch((err) => console.error('TTS failed:', err))
    .finally(() => {
      queueDepth = Math.max(0, queueDepth - 1)
      if (queueDepth === 0) setSpeaking(false)
    })
}

export function cancelSpeech(): void {
  speechSynthesis.cancel()
  queueDepth = 0
  setSpeaking(false)
}
