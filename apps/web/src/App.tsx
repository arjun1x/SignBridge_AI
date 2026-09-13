import { useEffect, useMemo, useState } from 'react'
import { SignPractice } from '../../desktop/src/main/SignPractice'
import { Logo } from '../../desktop/src/main/Logo'
import { detectCapabilities } from './capability'

// Web shell. The signing studio itself (camera, worker, recognition, editing,
// spoken output) is the same component the desktop app uses; here it runs
// against the browser's speechSynthesis until the in-browser neural voice lands.
export function App() {
  const caps = useMemo(() => detectCapabilities(), [])
  const [showDetails, setShowDetails] = useState(false)

  // Safari (iOS especially) only lets speechSynthesis start inside a user
  // gesture the first time. The visitor's first click (Start camera) primes it
  // with a silent utterance so later automatic speech is not swallowed.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const prime = (): void => {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      speechSynthesis.speak(u)
    }
    document.addEventListener('pointerdown', prime, { once: true, capture: true })
    return () => document.removeEventListener('pointerdown', prime, { capture: true })
  }, [])

  if (!caps.coreSupported) {
    return (
      <div className="app web-blocked">
        <header className="topbar">
          <a className="wordmark" href="/"><Logo className="logo" /><span>SignBridge<span className="brand-dot">.</span></span></a>
        </header>
        <main>
          <section className="card" role="alert" aria-labelledby="blocked-title">
            <p className="eyebrow">THIS DEVICE</p>
            <h2 id="blocked-title">SignBridge can't run in this browser yet.</h2>
            <ul className="web-reasons">{caps.blockers.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="card-desc">Try the latest Chrome, Edge, Firefox or Safari on a device with a camera.</p>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <a className="skip-link" href="#studio">Skip to signing studio</a>
      <header className="topbar">
        <a className="wordmark" href="/"><Logo className="logo" /><span>SignBridge<span className="brand-dot">.</span></span></a>
        <nav aria-label="Sections"><a className="nav-current" href="#studio">Studio</a><a href="#about">About</a></nav>
        <span className="pill">Runs in your browser · nothing leaves your device</span>
      </header>
      <main>
        <div className="page-intro">
          <div><p className="eyebrow">A SPACE TO CONNECT</p><h1>Your hands. Your voice.</h1></div>
          <p>Make yourself heard.<br /><span className="muted">One expression at a time.</span></p>
        </div>

        {caps.limitations.length > 0 && (
          <div className="web-limits">
            <button className="text-button" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
              {showDetails ? 'Hide' : 'Show'} what this browser supports ({caps.limitations.length} limit{caps.limitations.length === 1 ? '' : 's'})
            </button>
            {showDetails && <ul className="web-reasons small">{caps.limitations.map((r) => <li key={r}>{r}</li>)}</ul>}
          </div>
        )}

        <SignPractice />

        <section className="card" id="about" aria-labelledby="about-title">
          <div className="section-heading"><div><p className="eyebrow">02 / HOW IT WORKS</p><h2 id="about-title">Private by construction.</h2></div></div>
          <p className="card-desc">
            Hand tracking and the sign classifier run inside your browser with WebAssembly and WebGPU.
            Camera frames are processed on your device and never uploaded. Fingerspelling covers any word
            letter by letter; whole signs cover 250 common ASL signs. Recognized words are joined in signing
            order — this is not a translation of full ASL grammar.
          </p>
          <p className="small">
            Sending the voice into Discord or Zoom and live call captions are available in the Windows desktop app,
            and in Chrome/Edge on Windows once those features land here.
          </p>
        </section>
      </main>
      <footer className="app-footer"><span>SignBridge AI · Built for connection.</span><span>Experimental ASL recognition · Review words before speaking.</span></footer>
    </div>
  )
}
