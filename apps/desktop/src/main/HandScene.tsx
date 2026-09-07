import { useEffect, useRef, useState } from 'react'
import { Logo } from './Logo'

// Decorative, procedurally modeled hand, NOT an ASL teaching pose. Three.js
// loads only on the welcome screen and is disposed before camera recognition.
export function HandScene({ animate = true }: { animate?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    void import('./handSceneRenderer').then(({ mountHandScene }) => {
      if (disposed || !host.current) return
      cleanup = mountHandScene(host.current, animate)
      setReady(true)
    }).catch(() => setReady(false))
    return () => { disposed = true; cleanup() }
  }, [animate])
  return <div className="hand-scene" aria-hidden="true">
    {!ready && <Logo className="scene-fallback" />}
    <div className="scene-canvas" ref={host} />
    <div className="scene-orbit orbit-one" /><div className="scene-orbit orbit-two" />
    <span className="scene-coordinate coord-top">SIGN / CONNECT</span>
    <span className="scene-coordinate coord-bottom">3D HAND STUDY · ILLUSTRATION</span>
    <div className="floating-note"><span className="note-icon">Aa</span><div>Expression, in motion.<small>A space for your voice.</small></div></div>
  </div>
}
