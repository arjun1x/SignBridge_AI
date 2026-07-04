import { useCallback, useEffect, useRef, useState } from 'react'
import { isCapturing, listenForPcmPort, setPcmMuted, startCapture, stopCapture } from '../capture/audioCapture'
import { onSpeakingChange, refreshTtsEngine } from '../tts/ttsService'
import { CallSetup } from './CallSetup'
import { SignPractice } from './SignPractice'

interface Line {
  text: string
  ts: number
}

export function App() {
  const [modelFound, setModelFound] = useState<boolean | null>(null)
  const [modelDir, setModelDir] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState('')
  const [finals, setFinals] = useState<Line[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listenForPcmPort()
    refreshTtsEngine()
    // Echo guard: don't caption our own synthesized voice — but only when it
    // plays on the default output. Routed to VB-Cable, the loopback capture
    // never hears it, so captions can keep flowing during two-way use.
    const unsubscribeTts = onSpeakingChange((speaking, onDefaultOutput) =>
      setPcmMuted(speaking && onDefaultOutput)
    )
    window.signbridge.getStatus().then((s) => {
      setModelFound(s.modelFound)
      setModelDir(s.modelDir)
      setRunning(s.running)
    })
    const unsubscribeCaptions = window.signbridge.onCaption((ev) => {
      if (ev.kind === 'partial') setPartial(ev.text ?? '')
      if (ev.kind === 'final') {
        setPartial('')
        setFinals((prev) => [...prev.slice(-200), { text: ev.text ?? '', ts: ev.ts }])
      }
      if (ev.kind === 'error') setError(ev.text ?? 'Unknown STT error')
      if (ev.kind === 'state' && ev.running === false) setRunning(false)
    })
    return () => {
      unsubscribeTts()
      unsubscribeCaptions()
    }
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [finals, partial])

  const start = useCallback(async () => {
    setError(null)
    const res = await window.signbridge.startCaptions()
    if (!res.ok) {
      setError(res.error ?? 'Failed to start captions')
      return
    }
    try {
      await startCapture()
      setRunning(true)
    } catch (err) {
      setError(String(err))
      await window.signbridge.stopCaptions()
    }
  }, [])

  const stop = useCallback(async () => {
    stopCapture()
    await window.signbridge.stopCaptions()
    setRunning(false)
    setPartial('')
  }, [])

  return (
    <div className="app">
      <header>
        <h1>SignBridge AI</h1>
        <span className={`pill ${running ? 'pill-on' : 'pill-off'}`}>
          {running ? 'captions live' : 'idle'}
        </span>
      </header>

      <section className="card">
        <h2>Live captions (system audio → overlay)</h2>
        <p className="muted">
          Captures everything playing on this PC (Discord, Zoom, a video…) and shows live
          captions in the on-screen overlay.
        </p>
        {modelFound === false && (
          <p className="warn">
            Speech model not found. Run <code>npm run download:stt</code> in the repo root,
            then restart the app.
          </p>
        )}
        {modelDir && <p className="muted small">Model: {modelDir}</p>}
        {error && <p className="warn">{error}</p>}
        <div className="row">
          {!running ? (
            <button onClick={start} disabled={modelFound === false}>
              Start captions
            </button>
          ) : (
            <button className="secondary" onClick={stop}>
              Stop captions
            </button>
          )}
        </div>
      </section>

      <SignPractice />

      <CallSetup />

      <section className="card grow">
        <h2>Transcript</h2>
        <div className="log" ref={logRef}>
          {finals.map((l, i) => (
            <p key={i}>{l.text}</p>
          ))}
          {partial && <p className="partial">{partial}</p>}
          {!finals.length && !partial && (
            <p className="muted">Nothing yet — start captions and play some speech.</p>
          )}
        </div>
      </section>
    </div>
  )
}
