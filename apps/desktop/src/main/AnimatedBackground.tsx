export function AnimatedBackground({ dim = false }: { dim?: boolean }) {
  return <div className={`ambient ${dim ? 'ambient-dim' : ''}`} aria-hidden="true"><div className="ambient-grid" /></div>
}
