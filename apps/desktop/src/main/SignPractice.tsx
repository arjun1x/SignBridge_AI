import { useCallback, useEffect, useRef, useState } from 'react'
import {
  backspaceGloss,
  clearGlossBuffer,
  ModelInfo,
  setAutoSpeak,
  setSignMode,
  SignMode,
  SignPipelineStatus,
  speakNow,
  startSignPipeline,
  stopSignPipeline
} from '../vision/signPipeline'
import { speak } from '../tts/ttsService'

interface Prediction {
  gloss: string
  prob: number
  ts: number
}

interface FingerspellState {
  letter: string
  prob: number
  word: string
  available: boolean
}

// Direction 1 practice panel: webcam -> landmarks -> ONNX worker -> debounce
// -> sentence assembly -> TTS. The pipeline auto-selects the real trained
// model (signs_v1) when it's been synced in, else the untrained placeholder
// with loosened thresholds (glosses are garbage in that mode).
export function SignPractice() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [running, setRunning] = useState(false)
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [status, setStatus] = useState<SignPipelineStatus | null>(null)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [glossBuffer, setGlossBuffer] = useState<string[]>([])
  const [spoken, setSpoken] = useState<string[]>([])
  const [autoSpeakOn, setAutoSpeakOn] = useState(true)
  const [mode, setMode] = useState<SignMode>('signs')
  const [fs, setFs] = useState<FingerspellState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => stopSignPipeline, [])

  const start = useCallback(async () => {
    if (!videoRef.current) return
    setError(null)
    setModel(null)
    setSpoken([])
    await startSignPipeline(
      videoRef.current,
      {
        onReady: setModel,
        onStatus: setStatus,
        onPrediction: setPrediction,
        onGlossBuffer: setGlossBuffer,
        onSentence: (sentence) => {
          setSpoken((prev) => [...prev.slice(-20), sentence])
          speak(sentence)
        },
        onFingerspell: setFs,
        onError: (message) => setError(message)
      },
      { autoSpeak: autoSpeakOn }
    )
    setRunning(true)
  }, [autoSpeakOn])

  const stop = useCallback(() => {
    stopSignPipeline()
    setRunning(false)
    setModel(null)
    setStatus(null)
    setPrediction(null)
    setGlossBuffer([])
    setFs(null)
    setMode('signs')
  }, [])

  const switchMode = useCallback((m: SignMode) => {
    setMode(m)
    setSignMode(m)
    setPrediction(null)
  }, [])

  const toggleAutoSpeak = useCallback((enabled: boolean) => {
    setAutoSpeakOn(enabled)
    setAutoSpeak(enabled)
  }, [])

  return (
    <section className="card">
      <h2>Sign practice</h2>
      <p className="muted">
        Webcam -&gt; landmarks -&gt; recognition -&gt; glosses -&gt; spoken sentence.
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
            {running && !model && <span className="pill pill-off">loading model...</span>}
            {running && model && (
              <span
                className={`pill ${model.testMode ? 'pill-off' : 'pill-on'}`}
                title={model.testMode ? 'Untrained placeholder with loosened thresholds — glosses are garbage' : undefined}
              >
                {model.name}
                {model.valAcc !== null && ` (val ${(model.valAcc * 100).toFixed(0)}%)`}
                {model.testMode && ' — test mode'}
              </span>
            )}
          </div>

          <div className="row" style={{ marginTop: 8, gap: 16 }}>
            {running && (
              <span className="mode-toggle">
                <button
                  className={mode === 'signs' ? '' : 'secondary'}
                  onClick={() => switchMode('signs')}
                >
                  Signs
                </button>
                <button
                  className={mode === 'fingerspell' ? '' : 'secondary'}
                  onClick={() => switchMode('fingerspell')}
                  disabled={!fs?.available}
                  title={fs?.available ? 'Spell words letter by letter (ASL alphabet)' : 'Fingerspell model not trained yet'}
                >
                  Fingerspell
                </button>
              </span>
            )}
            <label className="muted small">
              <input
                type="checkbox"
                checked={autoSpeakOn}
                onChange={(e) => toggleAutoSpeak(e.target.checked)}
              />{' '}
              auto-speak on rest
            </label>
          </div>

          {status && (
            <p className="muted small" style={{ marginTop: 8 }}>
              hands: {status.handsPresent ? 'detected' : 'none'} · motion:{' '}
              {status.motionEnergy.toFixed(4)} · {status.isResting ? 'resting' : 'active'} ·{' '}
              {status.fps.toFixed(0)} fps
              {mode === 'signs' && prediction && (
                <>
                  {' '}
                  · top: {prediction.gloss} ({(prediction.prob * 100).toFixed(1)}%)
                </>
              )}
              {mode === 'fingerspell' && fs && fs.letter && (
                <>
                  {' '}
                  · letter: {fs.letter} ({(fs.prob * 100).toFixed(0)}%)
                </>
              )}
            </p>
          )}

          {(glossBuffer.length > 0 || (mode === 'fingerspell' && fs?.word)) && (
            <p style={{ marginTop: 8, fontSize: 18 }}>
              {glossBuffer.join(' ')}
              {mode === 'fingerspell' && fs?.word && (
                <span className="partial"> {fs.word}</span>
              )}{' '}
              <span className="partial">▎</span>
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
