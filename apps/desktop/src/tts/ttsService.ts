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
let queueDepth = 0
let speaking = false
let outputDeviceId = localStorage.getItem(DEVICE_STORAGE_KEY) ?? 'default'
let piperReady = false

export function setTtsOutputDevice(deviceId: string): void {
  outputDeviceId = deviceId
  localStorage.setItem(DEVICE_STORAGE_KEY, deviceId)
}

export function getTtsOutputDevice(): string {
  return outputDeviceId
}

export async function refreshTtsEngine(): Promise<'piper' | 'system'> {
  const status = await window.signbridge.ttsStatus().catch(() => ({ modelFound: false, ready: false }))
  piperReady = status.ready
  return piperReady ? 'piper' : 'system'
}

function setSpeaking(value: boolean): void {
  if (speaking === value) return
  speaking = value
  for (const l of listeners) l(value, outputDeviceId === 'default')
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
    if (outputDeviceId !== 'default') {
      await audio.setSinkId(outputDeviceId)
    }
    await audio.play()
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
    })
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
  const job = piperReady ? speakPiper(text, rate) : speakSystem(text, rate)
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
