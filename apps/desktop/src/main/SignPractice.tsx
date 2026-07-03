import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SignPipelineStatus,
  startSignPipeline,
  stopSignPipeline
} from '../vision/signPipeline'

interface Prediction {
  gloss: string
  prob: number
  ts: number
}

// Week 2 scaffolding: exercises the full webcam -> landmarks -> ONNX worker
// pipeline against a randomly-initialized placeholder model (see
// ml/signbridge_ml/make_dummy_model.py) so predictions here are expected
// to be garbage until a real GISLR-trained model is exported and synced in.
export function SignPractice() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [running, setRunning] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [status, setStatus] = useState<SignPipelineStatus | null>(null)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => stopSignPipeline, [])

  const start = useCallback(async () => {
    if (!videoRef.current) return
    setError(null)
    setModelReady(false)
    await startSignPipeline(videoRef.current, {
      onReady: () => setModelReady(true),
      onStatus: setStatus,
      onPrediction: setPrediction,
      onError: (message) => setError(message)
    })
    setRunning(true)
  }, [])

  const stop = useCallback(() => {
    stopSignPipeline()
    setRunning(false)
    setModelReady(false)
    setStatus(null)
    setPrediction(null)
  }, [])

  return (
    <section className="card">
      <h2>Sign practice (placeholder model)</h2>
      <p className="muted">
        Webcam -&gt; MediaPipe landmarks -&gt; ONNX worker. Uses an untrained
        placeholder model — predictions are not meaningful yet.
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
          <div className="row">
            {!running ? (
              <button onClick={start}>Start sign practice</button>
            ) : (
              <button className="secondary" onClick={stop}>
                Stop
              </button>
            )}
            {running && <span className="pill pill-off">{modelReady ? 'model loaded' : 'loading model...'}</span>}
          </div>

          {status && (
            <p className="muted small" style={{ marginTop: 10 }}>
              hands: {status.handsPresent ? 'detected' : 'none'} · motion:{' '}
              {status.motionEnergy.toFixed(4)} · {status.isResting ? 'resting' : 'active'} ·{' '}
              {status.fps.toFixed(0)} fps
            </p>
          )}

          {prediction && (
            <p style={{ marginTop: 10, fontSize: 18 }}>
              {prediction.gloss} <span className="muted small">({(prediction.prob * 100).toFixed(0)}%)</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
