// Full-viewport ambient background: large blurred gradient orbs drifting on
// slow independent orbits + a faint dot grid. Pure CSS animation (transform/
// opacity only, GPU-composited); honors prefers-reduced-motion via CSS.
export function AnimatedBackground({ dim = false }: { dim?: boolean }) {
  return (
    <div className={`ambient ${dim ? 'ambient-dim' : ''}`} aria-hidden="true">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
      <div className="dotgrid" />
    </div>
  )
}
