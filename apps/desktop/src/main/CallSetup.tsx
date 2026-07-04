import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getTtsLocalMonitor,
  getTtsOutputDevice,
  refreshTtsEngine,
  setTtsLocalMonitor,
  setTtsOutputDevice,
  speak
} from '../tts/ttsService'

interface OutputDevice {
  deviceId: string
  label: string
}

const CABLE_INPUT_HINT = 'CABLE Input'
const CABLE_OUTPUT_HINT = 'CABLE Output'

// Call-integration wizard: routes the synthesized voice into VB-Audio
// Virtual Cable so Discord/Zoom hear it as a microphone. The user installs
// VB-Cable once, points the call app's mic at "CABLE Output", and picks
// "CABLE Input" as SignBridge's voice output here.
export function CallSetup() {
  const [outputs, setOutputs] = useState<OutputDevice[]>([])
  const [cableDetected, setCableDetected] = useState(false)
  const [selected, setSelected] = useState(getTtsOutputDevice())
  const [monitor, setMonitor] = useState(getTtsLocalMonitor())
  const [engine, setEngine] = useState<'piper' | 'system'>('system')
  const [level, setLevel] = useState(0)
  const [metering, setMetering] = useState(false)
  const meterCleanup = useRef<(() => void) | null>(null)

  const scanDevices = useCallback(async () => {
    // Device labels are only exposed after one successful getUserMedia grant.
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      probe.getTracks().forEach((t) => t.stop())
    } catch {
      // no mic permission — labels may be empty, detection still attempted
    }
    const devices = await navigator.mediaDevices.enumerateDevices()
    const outs = devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
    setOutputs(outs)
    setCableDetected(outs.some((d) => d.label.includes(CABLE_INPUT_HINT)))
    setEngine(await refreshTtsEngine())
  }, [])

  useEffect(() => {
    scanDevices()
    return () => meterCleanup.current?.()
  }, [scanDevices])

  const choose = useCallback((deviceId: string) => {
    setSelected(deviceId)
    setTtsOutputDevice(deviceId)
  }, [])

  const testVoice = useCallback(() => {
    speak('SignBridge voice test. If your call is set up, the other side hears this.')
  }, [])

  // Level meter on the CABLE Output mic proves the whole loop end-to-end:
  // TTS -> CABLE Input -> (virtual wire) -> CABLE Output, which is exactly
  // what the call app consumes.
  const toggleMeter = useCallback(async () => {
    if (metering) {
      meterCleanup.current?.()
      return
    }
    const devices = await navigator.mediaDevices.enumerateDevices()
    const cableOut = devices.find((d) => d.kind === 'audioinput' && d.label.includes(CABLE_OUTPUT_HINT))
    if (!cableOut) return

    // Raw capture: default constraints enable echo cancellation, which
    // treats our own browser-played TTS as echo and subtracts it — the
    // meter would show silence exactly when the loop is working.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: cableOut.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v))
      setLevel(peak)
    }, 100)

    meterCleanup.current = () => {
      clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      ctx.close()
      setMetering(false)
      setLevel(0)
      meterCleanup.current = null
    }
    setMetering(true)
  }, [metering])

  return (
    <section className="card">
      <h2>Call integration (voice → Discord/Zoom)</h2>

      {!cableDetected ? (
        <>
          <p className="muted">
            To make calls hear the synthesized voice, install the free VB-Audio Virtual
            Cable, reboot, then rescan.
          </p>
          <div className="row">
            <button onClick={() => window.open('https://vb-audio.com/Cable/', '_blank')}>
              Get VB-Cable
            </button>
            <button className="secondary" onClick={scanDevices}>
              Rescan devices
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            VB-Cable detected. 1) Voice output below → <b>CABLE Input</b>. 2) In
            Discord/Zoom, set microphone → <b>CABLE Output</b>. 3) Test.
          </p>
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={selected} onChange={(e) => choose(e.target.value)}>
              <option value="default">System default (local speakers)</option>
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <button onClick={testVoice}>Test voice</button>
            <button className="secondary" onClick={toggleMeter}>
              {metering ? 'Stop meter' : 'Meter CABLE Output'}
            </button>
            {metering && (
              <span className="level-meter">
                <span className="level-fill" style={{ width: `${Math.min(100, level * 140)}%` }} />
              </span>
            )}
          </div>
          <label className="muted small" style={{ display: 'inline-block', marginTop: 8 }}>
            <input
              type="checkbox"
              checked={monitor}
              onChange={(e) => {
                setMonitor(e.target.checked)
                setTtsLocalMonitor(e.target.checked)
              }}
            />{' '}
            also play a quiet copy on my speakers (so I know when it speaks)
          </label>
        </>
      )}

      <p className="muted small" style={{ marginTop: 8 }}>
        Voice engine: {engine === 'piper' ? 'Piper (routable)' : 'System speechSynthesis — run "npm run download:tts" for the routable voice'}
      </p>
    </section>
  )
}
