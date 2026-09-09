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
  // Guest access lasts for this app session only, so the sign-in page greets every launch
  // unless a Google profile is stored.
  function guest() { sessionStorage.setItem('signbridge.guest', '1'); onSignedIn(null) }
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
          <button className="google-btn large" onClick={google} disabled={busy || !window.signbridge}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            {busy ? 'Waiting for browser…' : 'Continue with Google'}
          </button>
          <button className="secondary large" onClick={guest} disabled={busy}>Continue as guest <span aria-hidden="true">↗</span></button>
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
