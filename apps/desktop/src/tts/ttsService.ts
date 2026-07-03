// speechSynthesis wrapper with a queue and speaking-state notifications.
// MVP engine (Windows SAPI voices via Chromium). Known limitation, planned
// for week 4: speechSynthesis cannot select an output device, so routing
// into VB-Cable will require swapping to a PCM-based engine + setSinkId —
// callers only depend on speak()/onSpeakingChange, so the swap is contained
// here. The speaking-state events also drive the caption echo guard (the
// loopback capture would otherwise transcribe our own synthesized voice).
type SpeakingListener = (speaking: boolean) => void

const listeners = new Set<SpeakingListener>()
let queueDepth = 0
let speaking = false

function setSpeaking(value: boolean): void {
  if (speaking === value) return
  speaking = value
  for (const l of listeners) l(value)
}

export function onSpeakingChange(listener: SpeakingListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isSpeaking(): boolean {
  return speaking
}

export function speak(text: string, opts?: { rate?: number; voiceName?: string }): void {
  if (!text.trim()) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = opts?.rate ?? 1.0
  if (opts?.voiceName) {
    const voice = speechSynthesis.getVoices().find((v) => v.name === opts.voiceName)
    if (voice) utterance.voice = voice
  }

  queueDepth++
  setSpeaking(true)
  const settle = (): void => {
    queueDepth = Math.max(0, queueDepth - 1)
    if (queueDepth === 0) setSpeaking(false)
  }
  utterance.onend = settle
  utterance.onerror = settle

  speechSynthesis.speak(utterance)
}

export function cancelSpeech(): void {
  speechSynthesis.cancel()
  queueDepth = 0
  setSpeaking(false)
}

export function listVoices(): { name: string; lang: string }[] {
  return speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang }))
}
