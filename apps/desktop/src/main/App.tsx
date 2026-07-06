import { useCallback, useEffect, useRef, useState } from 'react'
import { listenForPcmPort, setPcmMuted, startCapture, stopCapture } from '../capture/audioCapture'
import { onSpeakingChange, refreshTtsEngine } from '../tts/ttsService'
import { AnimatedBackground } from './AnimatedBackground'
import { CallSetup } from './CallSetup'
import { Logo } from './Logo'
import { SignIn } from './SignIn'
import { SignPractice } from './SignPractice'

interface Line {
  text: string
  ts: number
}

type AuthState = { checked: false } | { checked: true; profile: UserProfile | null; guest: boolean }

export function App() {
  const [auth, setAuth] = useState<AuthState>({ checked: false })
  const [modelFound, setModelFound] = useState<boolean | null>(null)
  const [modelDir, setModelDir] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState('')
  const [finals, setFinals] = useState<Line[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.signbridge.authGet().then((profile) => {
      setAuth({ checked: true, profile, guest: localStorage.getItem('signbridge.guest') === '1' })
    })
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

  const signOut = useCallback(async () => {
    await window.signbridge.authSignOut()
    localStorage.removeItem('signbridge.guest')
    setAuth({ checked: true, profile: null, guest: false })
  }, [])

  if (!auth.checked) return null
  if (!auth.profile && !auth.guest) {
    return (
      <SignIn
        onSignedIn={(profile) => setAuth({ checked: true, profile, guest: profile === null })}
      />
    )
  }

  const user = auth.profile

  return (
    <div className="app">
      <AnimatedBackground dim />
      <header className="topbar reveal">
        <Logo className="logo" animated />
        <h1>
          Sign<span>Bridge</span>
        </h1>
        <span className={`pill ${running ? 'pill-on' : ''}`}>
          <i className="dot" />
          {running ? 'Captions live' : 'Captions idle'}
        </span>
        <div className="spacer" />
        <div className="user-chip">
          {user?.avatar ? (
            <img src={user.avatar} alt="" />
          ) : (
            <span className="avatar-fallback">{(user?.name ?? 'G')[0].toUpperCase()}</span>
          )}
          <span>{user?.name ?? 'Guest'}</span>
          <button onClick={signOut} title={user ? 'Sign out' : 'Back to sign-in'}>
            {user ? 'Sign out' : 'Sign in'}
          </button>
        </div>
      </header>

      <section className="card reveal d1">
        <h2>Live captions</h2>
        <p className="card-desc">
          Hears everything playing on this PC — Discord, Zoom, videos — and shows what's
          said as captions floating above your call.
        </p>
        {modelFound === false && (
          <p className="warn">
            Speech model not found. Run <code>npm run download:stt</code> in the repo root,
            then restart the app.
          </p>
        )}
        {modelDir && (
          <p className="small" title={modelDir} style={{ margin: '2px 0 0' }}>
            Speech model: English (streaming) · ready
          </p>
        )}
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

      <div className="reveal d2">
        <SignPractice />
      </div>

      <div className="reveal d3">
        <CallSetup />
      </div>

      <section className="card grow reveal d4">
        <h2>Transcript</h2>
        <div className="log" ref={logRef}>
          {finals.map((l, i) => (
            <p key={i}>{l.text}</p>
          ))}
          {partial && <p className="partial">{partial}</p>}
          {!finals.length && !partial && (
            <p className="muted">Everything captioned in this session will appear here.</p>
          )}
        </div>
      </section>
    </div>
  )
}
