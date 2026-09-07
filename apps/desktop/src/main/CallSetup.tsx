import { useEffect, useRef, useState } from 'react'
import { getTtsLocalMonitor, getTtsOutputDevice, refreshTtsEngine, setTtsLocalMonitor, setTtsOutputDevice, speak } from '../tts/ttsService'
export function CallSetup() {
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const [selected, setSelected] = useState(getTtsOutputDevice())
  const [monitor, setMonitor] = useState(getTtsLocalMonitor())
  const [engine, setEngine] = useState<'piper' | 'system'>('system')
  const [error, setError] = useState('')
  const [level, setLevel] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const cleanup = useRef<(() => void) | null>(null)
  const alive = useRef(true)
  const metering = useRef(false)
  const cableDetected = outputs.some((d) => d.label.includes('CABLE Input'))
  async function scan(requestPermission = false) {
    try {
      if (requestPermission) {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((t) => t.stop())
      }
      const devices = await navigator.mediaDevices.enumerateDevices()
      if (alive.current) setOutputs(devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'))
      // Engine readiness may take a moment after launch; do not hold the device list on it.
      const engine = await refreshTtsEngine()
      if (alive.current) setEngine(engine)
    } catch (err) { if (alive.current) setError(`Could not scan audio devices: ${String(err)}`) }
  }
  useEffect(() => {
    alive.current = true
    void scan() // No microphone prompt until the user requests a device scan.
    const changed = () => void scan()
    navigator.mediaDevices?.addEventListener('devicechange', changed)
    return () => { alive.current = false; metering.current = false; cleanup.current?.(); navigator.mediaDevices?.removeEventListener('devicechange', changed) }
  }, [])
  async function toggleMeter() {
    if (level !== null) { cleanup.current?.(); return }
    setError(''); setBusy(true); metering.current = true
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cable = devices.find((d) => d.kind === 'audioinput' && d.label.includes('CABLE Output'))
      if (!cable) throw new Error('No virtual cable input found. Install VB-Cable, then scan devices.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: cable.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      if (!alive.current || !metering.current) { stream.getTracks().forEach((t) => t.stop()); return }
      const ctx = new AudioContext(); const analyser = ctx.createAnalyser()
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Float32Array(analyser.fftSize)
      const timer = setInterval(() => { analyser.getFloatTimeDomainData(data); setLevel(Math.max(...Array.from(data, Math.abs))) }, 100)
      cleanup.current = () => {
        clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); void ctx.close()
        if (alive.current) setLevel(null)
        cleanup.current = null; metering.current = false
      }
      setLevel(0)
    } catch (err) { if (alive.current) setError(String(err)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="card" aria-labelledby="call-title">
    <div className="section-heading"><div><p className="eyebrow">03 / BRING YOUR VOICE ALONG</p><h2 id="call-title">Connect to your call.</h2></div></div>
    <p className="card-desc">Choose where your spoken words go. Use a virtual cable to send them into Discord or Zoom.</p>
    {error && <p className="warn" role="alert">{error}</p>}
    <label className="small" htmlFor="voice-output">Voice output</label>
    <select id="voice-output" value={selected} onChange={(e) => { setSelected(e.target.value); setTtsOutputDevice(e.target.value) }}>
      <option value="default">This computer's speakers</option>
      {outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label.startsWith('CABLE Input') ? 'Virtual cable → your call' : d.label || 'Audio output'}</option>)}
    </select>
    <div className="row"><button className="secondary" onClick={() => speak('Hello from SignBridge. This is a voice test.')}>Test voice</button><button className="text-button" onClick={() => void scan(true)}>Scan devices</button></div>
    <label className="switch-label"><input type="checkbox" className="switch" checked={monitor} onChange={(e) => { setMonitor(e.target.checked); setTtsLocalMonitor(e.target.checked) }} />Also play a quiet copy on my speakers</label>
    <div className="row"><span className="pill">{engine === 'piper' ? 'Neural voice ready' : 'System voice'}</span></div>
    {engine !== 'piper' && <p className="small">Install the local neural voice to route speech into a call. The system voice uses your default speakers.</p>}
    {cableDetected ? <><p className="small">In your call app, choose <b>CABLE Output</b> as the microphone.</p><button className="secondary" onClick={toggleMeter} disabled={busy}>{busy ? 'Connecting…' : level === null ? 'Check connection' : 'Stop connection check'}</button>{level !== null && <div className="row"><meter min={0} max={1} value={level} aria-label="Virtual cable audio level" /><span className="small">{Math.round(level * 100)}% peak</span></div>}</> : <p className="small">First time connecting? <a href="https://vb-audio.com/Cable/" target="_blank" rel="noreferrer" style={{ color:'var(--brand)', textDecoration:'underline' }}>Install VB-Cable</a>, restart your PC, and scan again.</p>}
  </section>
}
