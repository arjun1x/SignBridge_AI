import { useCallback, useEffect, useRef, useState } from 'react'
import {
  backspaceGloss,
  clearGlossBuffer,
  setAutoSpeak,
  SignPipelineStatus,
  speakNow,
  startSignPipeline,
  stopSignPipeline
} from '../vision/signPipeline'
import { DEFAULT_DEBOUNCE } from '../inference/debounce'
import { speak } from '../tts/ttsService'

interface Prediction {
  gloss: string
  prob: number
  ts: number
}

// Loose thresholds for exercising the pipeline against the untrained
// placeholder model, whose top-1 probability hovers near 1/250 — the real
// thresholds would (correctly) never fire on it.
const TEST_MODE_DEBOUNCE = { minProb: 0.004, minConsecutive: 2 }

// Week 2/3 scaffolding: exercises webcam -> landmarks -> ONNX worker ->
// debounce -> sentence assembly -> TTS against a randomly-initialized
// placeholder model (see ml/signbridge_ml/make_dummy_model.py), so glosses
// are garbage until a real GISLR-trained model is exported and synced in.
export function SignPractice() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [running, setRunning] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [status, setStatus] = useState<SignPipelineStatus | null>(null)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [glossBuffer, setGlossBuffer] = useState<string[]>([])
  const [spoken, setSpoken] = useState<string[]>([])
  const [autoSpeakOn, setAutoSpeakOn] = useState(true)
  const [testMode, setTestMode] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => stopSignPipeline, [])

  const start = useCallback(async () => {
    if (!videoRef.current) return
    setError(null)
    setModelReady(false)
    setSpoken([])
    await startSignPipeline(
      videoRef.current,
      {
        onReady: () => setModelReady(true),
        onStatus: setStatus,
        onPrediction: setPrediction,
        onGlossBuffer: setGlossBuffer,
        onSentence: (sentence) => {
          setSpoken((prev) => [...prev.slice(-20), sentence])
          speak(sentence)
        },
        onError: (message) => setError(message)
      },
      {
        debounce: testMode ? TEST_MODE_DEBOUNCE : DEFAULT_DEBOUNCE,
        autoSpeak: autoSpeakOn
      }
    )
    setRunning(true)
  }, [testMode, autoSpeakOn])

  const stop = useCallback(() => {
    stopSignPipeline()
    setRunning(false)
    setModelReady(false)
    setStatus(null)
    setPrediction(null)
    setGlossBuffer([])
  }, [])

  const toggleAutoSpeak = useCallback((enabled: boolean) => {
    setAutoSpeakOn(enabled)
    setAutoSpeak(enabled)
  }, [])

  return (
    <section className="card">
      <h2>Sign practice (placeholder model)</h2>
      <p className="muted">
        Webcam -&gt; landmarks -&gt; recognition -&gt; glosses -&gt; spoken sentence. Untrained
        placeholder model — glosses are not meaningful yet.
      </p>
      {error && <p className="warn">{error}</p>}

      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ width: 240, height: 180, background: '#000', borderRadius: 8 }}
        />
        <div style={{ flex: 1 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {!running ? (
              <button onClick={start}>Start sign practice</button>
            ) : (
              <>
                <button className="secondary" onClick={stop}>
                  Stop
                </button>
                <button onClick={speakNow} disabled={glossBuffer.length === 0}>
                  Speak
                </button>
                <button className="secondary" onClick={backspaceGloss} disabled={glossBuffer.length === 0}>
                  ⌫
                </button>
                <button className="secondary" onClick={clearGlossBuffer} disabled={glossBuffer.length === 0}>
                  Clear
                </button>
              </>
            )}
            {running && (
              <span className="pill pill-off">{modelReady ? 'model loaded' : 'loading model...'}</span>
            )}
          </div>

          <div className="row" style={{ marginTop: 8, gap: 16 }}>
            <label className="muted small">
              <input
                type="checkbox"
                checked={autoSpeakOn}
                onChange={(e) => toggleAutoSpeak(e.target.checked)}
              />{' '}
              auto-speak on rest
            </label>
            <label className="muted small" title="Loosens thresholds so the untrained model still produces glosses">
              <input
                type="checkbox"
                checked={testMode}
                disabled={running}
                onChange={(e) => setTestMode(e.target.checked)}
              />{' '}
              test mode
            </label>
          </div>

          {status && (
            <p className="muted small" style={{ marginTop: 8 }}>
              hands: {status.handsPresent ? 'detected' : 'none'} · motion:{' '}
              {status.motionEnergy.toFixed(4)} · {status.isResting ? 'resting' : 'active'} ·{' '}
              {status.fps.toFixed(0)} fps
              {prediction && (
                <>
                  {' '}
                  · top: {prediction.gloss} ({(prediction.prob * 100).toFixed(1)}%)
                </>
              )}
            </p>
          )}

          {glossBuffer.length > 0 && (
            <p style={{ marginTop: 8, fontSize: 18 }}>
              {glossBuffer.join(' ')} <span className="partial">▎</span>
            </p>
          )}

          {spoken.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {spoken.slice(-3).map((s, i) => (
                <p key={i} className="muted small">
                  🔊 {s}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
