import { useState } from 'react'
import { AnimatedBackground } from './AnimatedBackground'
import { Logo } from './Logo'
import { HandScene } from './HandScene'

export function SignIn({ onSignedIn }: { onSignedIn: (profile: UserProfile | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  async function google() {
    setBusy(true); setError('')
    try {
      const result = await window.signbridge.authSignIn()
      if (result.ok && result.profile) onSignedIn(result.profile)
      else setError(result.error ?? 'Sign-in failed. You can still continue as a guest.')
    } catch { setError('Sign-in is unavailable. You can still continue as a guest.') }
    finally { setBusy(false) }
  }
  function guest() { localStorage.setItem('signbridge.guest', '1'); onSignedIn(null) }
  return <div className={`signin ${motion ? '' : 'motion-off'}`}>
    <AnimatedBackground />
    <header className="welcome-header">
      <a className="wordmark" href="#main"><Logo className="logo" /><span>SignBridge<span className="brand-dot">.</span></span></a>
      <span className="header-note">A little closer. A lot more connected.</span>
      <button className="text-button" onClick={() => setMotion(!motion)} aria-pressed={motion}>Motion {motion ? 'on' : 'off'}</button>
    </header>
    <main className="hero" id="main">
      <div className="hero-copy reveal">
        <p className="eyebrow"><span className="eyebrow-line" /> YOUR EXPRESSION. YOUR CONNECTION.</p>
        <h1 className="hero-title">Let your hands<br /><span>do the talking.</span></h1>
        <p className="hero-sub">Turn fingerspelling and supported ASL signs into a voice. Follow the conversation with live captions. Make room for every way of connecting.</p>
        {error && <p className="warn" role="alert">{error}</p>}
        <div className="hero-actions">
          <button className="primary large" onClick={guest}>Open signing studio <span aria-hidden="true">↗</span></button>
          <button className="secondary large" onClick={google} disabled={busy || !window.signbridge}>
            <span className="google-mark" aria-hidden="true">G</span>{busy ? 'Opening sign-in…' : 'Google sign-in'}
          </button>
        </div>
        <p className="signin-note"><span aria-hidden="true">◈</span> Guest access. No account needed.<br />Recognition runs on your device; camera frames stay local.</p>
      </div>
      <HandScene animate={motion} />
    </main>
    <footer className="welcome-features">
      <div><span className="feature-index">01</span><p>Sign & spell<small>Letters and supported signs</small></p></div>
      <div><span className="feature-index">02</span><p>Give it a voice<small>Speak through your call</small></p></div>
      <div><span className="feature-index">03</span><p>Stay in the conversation<small>Live desktop captions</small></p></div>
    </footer>
    <p className="welcome-footnote">ASL recognition is experimental. Supported signs and fingerspelling do not translate full ASL grammar.</p>
  </div>
}
