import { useEffect, useRef, useState } from 'react'
import './overlay.css'

const IDLE_FADE_MS = 6000

// Caption card rendered in the transparent click-through overlay window.
// The window ignores mouse events except while the grip is hovered — the grip
// asks the main process for interactivity so the user can drag the overlay.
export function Overlay() {
  const [finals, setFinals] = useState<string[]>([])
  const [partial, setPartial] = useState('')
  const [visible, setVisible] = useState(false)
  const lastUpdate = useRef(0)

  useEffect(() => {
    const unsubscribe = window.signbridge.onCaption((ev) => {
      if (ev.kind === 'partial') setPartial(ev.text ?? '')
      if (ev.kind === 'final') {
        setPartial('')
        setFinals((prev) => [...prev.slice(-1), ev.text ?? ''])
      }
      if (ev.kind === 'partial' || ev.kind === 'final') {
        lastUpdate.current = Date.now()
        setVisible(true)
      }
    })
    const fadeTimer = setInterval(() => {
      if (Date.now() - lastUpdate.current > IDLE_FADE_MS) setVisible(false)
    }, 1000)
    return () => {
      unsubscribe()
      clearInterval(fadeTimer)
    }
  }, [])

  return (
    <div className={`overlay-root ${visible ? 'visible' : ''}`}>
      <div
        className="grip"
        title="Drag to move captions"
        onMouseEnter={() => window.signbridge.setOverlayInteractive(true)}
        onMouseLeave={() => window.signbridge.setOverlayInteractive(false)}
      >
        ⠿
      </div>
      <div className="caption-card">
        {finals.map((text, i) => (
          <p key={i} className="final">
            {text}
          </p>
        ))}
        {partial && <p className="partial">{partial}</p>}
      </div>
    </div>
  )
}
