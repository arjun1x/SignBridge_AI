// Full-viewport ambient background: a slowly rotating aurora sweep, five large
// blurred gradient orbs on independent closed-loop orbits, and a drifting dot
// grid over a static base wash.
//
// Everything animates on transform/opacity only, so it stays on the compositor
// and never competes with the renderer's main thread — which is also running
// MediaPipe landmark extraction and feeding the ONNX worker's sliding window.
// That rules out canvas/rAF particle effects here, however nice they look.
// Honors prefers-reduced-motion via CSS.
export function AnimatedBackground({ dim = false }: { dim?: boolean }) {
  return (
    <div className={`ambient ${dim ? 'ambient-dim' : ''}`} aria-hidden="true">
      <div className="aurora" />
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
      <div className="orb orb-d" />
      <div className="orb orb-e" />
      <div className="dotgrid" />
    </div>
  )
}
