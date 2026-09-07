import { useEffect, useRef, useState } from 'react'
import { listenForPcmPort, setPcmMuted, startCapture, stopCapture } from '../capture/audioCapture'
import { onSpeakingChange, refreshTtsEngine, cancelSpeech } from '../tts/ttsService'
import { AnimatedBackground } from './AnimatedBackground'
import { CallSetup } from './CallSetup'
import { Logo } from './Logo'
import { SignIn } from './SignIn'
import { SignPractice } from './SignPractice'
import { stopSignPipeline } from '../vision/signPipeline'

export function App() {
  const [checked, setChecked] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [guest, setGuest] = useState(() => localStorage.getItem('signbridge.guest') === '1')
  const [modelFound, setModelFound] = useState(false)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [partial, setPartial] = useState('')
  const [finals, setFinals] = useState<{ text: string; ts: number }[]>([])
  const log = useRef<HTMLDivElement>(null)
  const desktop = Boolean(window.signbridge)
  useEffect(() => {
    let disposed = false
    if (!desktop) { setChecked(true); return }
    void window.signbridge.authGet().then((p) => { if (!disposed) setProfile(p) }).catch(() => {}).finally(() => { if (!disposed) setChecked(true) })
    listenForPcmPort(); void refreshTtsEngine()
    const offTts = onSpeakingChange((speaking, onDefaultOutput) => setPcmMuted(speaking && onDefaultOutput))
    void window.signbridge.getStatus().then((s) => { if (!disposed) { setModelFound(s.modelFound); setRunning(s.running) } }).catch(() => { if (!disposed) setError('Could not check the speech model. Restart the desktop app.') })
    const offCaptions = window.signbridge.onCaption((ev) => {
      if (ev.kind === 'partial') setPartial(ev.text ?? '')
      if (ev.kind === 'final') { setPartial(''); setFinals((prev) => [...prev.slice(-199), { text: ev.text ?? '', ts: ev.ts }]) }
      if (ev.kind === 'error') { setError(ev.text ?? 'Captioning failed'); stopCapture(); setRunning(false) }
      if (ev.kind === 'state' && ev.running === false) { stopCapture(); setRunning(false) }
    })
    return () => { disposed = true; offTts(); offCaptions(); stopCapture() }
  }, [desktop])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [finals, partial])
  async function toggleCaptions() {
    setBusy(true); setError('')
    try {
      if (running) { stopCapture(); await window.signbridge.stopCaptions(); setRunning(false); setPartial('') }
      else {
        const result = await window.signbridge.startCaptions()
        if (!result.ok) throw new Error(result.error ?? 'Could not start captions')
        try { await startCapture(); setRunning(true) }
        catch (err) { stopCapture(); await window.signbridge.stopCaptions(); throw err }
      }
    } catch (err) { setError(String(err)) }
    finally { setBusy(false) }
  }
  async function signOut() {
    stopSignPipeline(); cancelSpeech(); stopCapture()
    if (desktop) {
      await window.signbridge.stopCaptions().catch(() => {})
      await window.signbridge.authSignOut().catch(() => {})
    }
    setRunning(false); localStorage.removeItem('signbridge.guest'); setProfile(null); setGuest(false)
  }
  if (!checked) return <div className="app-loading" role="status"><Logo className="logo" />Opening your studio…</div>
  if (!profile && !guest) return <SignIn onSignedIn={(p) => { setProfile(p); setGuest(!p) }} />
  return <div className="app">
    <a className="skip-link" href="#studio">Skip to signing studio</a>
    <AnimatedBackground dim />
    <header className="topbar">
      <a className="wordmark" href="#studio"><Logo className="logo" /><span>SignBridge<span className="brand-dot">.</span></span></a>
      <nav aria-label="Studio sections"><a className="nav-current" href="#studio">Studio</a><a href="#captions">Captions</a><a href="#call-setup">Call setup</a></nav>
      <div className="user-chip">{profile?.avatar ? <img src={profile.avatar} alt="" /> : <span className="avatar-fallback">{(profile?.name ?? 'G')[0].toUpperCase()}</span>}<span>{profile?.name?.split(' ')[0] ?? 'Guest'}</span><button className="text-button" onClick={signOut}>{profile ? 'Sign out' : 'Sign in'}</button></div>
    </header>
    <main>
      <div className="page-intro"><div><p className="eyebrow">A SPACE TO CONNECT</p><h1>Your hands. Your voice.</h1></div><p>Make yourself heard.<br /><span className="muted">One expression at a time.</span></p></div>
      <SignPractice />
      <div className="conversation-grid">
        <section className="card captions-card" id="captions" aria-labelledby="captions-title">
          <div className="section-heading"><div><p className="eyebrow">02 / THE OTHER SIDE</p><h2 id="captions-title">Keep up with every word.</h2></div><span className={`pill ${running ? 'pill-on' : ''}`}>{running ? 'Live' : 'Captions off'}</span></div>
          <p className="card-desc">Turn sound from Discord, Zoom, and your PC into captions that float above your call.</p>
          {!desktop && <p className="small">Live call captions are available in the Windows desktop app.</p>}
          {desktop && !modelFound && <p className="small">Install the local speech model using the setup guide to enable captions.</p>}
          {error && <p className="warn" role="alert">{error}</p>}
          <div className="row"><button className={running ? 'secondary' : ''} onClick={toggleCaptions} disabled={busy || !desktop || !modelFound}>{busy ? 'Please wait…' : running ? 'Stop captions' : 'Start live captions'}</button><span className="small">English · on device</span></div>
          <div className="transcript-heading"><h3>Conversation transcript</h3><span className="small">This session</span></div>
          <div className="log" ref={log} role="log" aria-label="Conversation transcript" aria-live="polite" aria-relevant="additions text">
            {finals.map((line, i) => <p key={`${line.ts}-${i}`}><time>{new Date(line.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{line.text}</p>)}
            {partial && <p className="partial">{partial}</p>}
            {!finals.length && !partial && <div className="transcript-empty"><span aria-hidden="true">≋</span><p>A little quiet here.<small>Spoken words will appear when captions are on.</small></p></div>}
          </div>
        </section>
        <div id="call-setup"><CallSetup /></div>
      </div>
    </main>
    <footer className="app-footer"><span>SignBridge AI · Built for connection.</span><span>Experimental ASL recognition · Review words before speaking.</span></footer>
  </div>
}
