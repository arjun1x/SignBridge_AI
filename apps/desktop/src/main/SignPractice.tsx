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
      <p className="card-desc">
        Sign at your webcam — recognized words build a sentence and are spoken aloud.
      </p>
      {error && <p className="warn">{error}</p>}

      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        <div className="preview">
          <video ref={videoRef} muted playsInline />
          {!running && (
            <div className="preview-empty">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              Camera preview appears here
              <br />
              when you start
            </div>
          )}
        </div>
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
            {running && !model && (
              <span className="pill">
                <i className="dot" />
                Loading model…
              </span>
            )}
            {running && model && (
              <span
                className={`pill ${model.testMode ? '' : 'pill-on'}`}
                title={
                  model.testMode
                    ? 'Untrained placeholder with loosened thresholds — words are not meaningful'
                    : `Model: ${model.name}${model.valAcc !== null ? ` · ${(model.valAcc * 100).toFixed(0)}% validation accuracy` : ''}`
                }
              >
                <i className="dot" />
                {model.testMode ? 'Demo model' : 'Recognition ready'}
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
            <label className="switch-label">
              <input
                type="checkbox"
                className="switch"
                checked={autoSpeakOn}
                onChange={(e) => toggleAutoSpeak(e.target.checked)}
              />
              Speak automatically when I pause
            </label>
          </div>

          {status && (
            <p
              className="small"
              style={{ marginTop: 10 }}
              title={`motion ${status.motionEnergy.toFixed(4)} · ${status.fps.toFixed(0)} fps`}
            >
              {!status.handsPresent
                ? 'Show your hands to begin'
                : status.isResting
                  ? 'Hands at rest'
                  : 'Watching your signing…'}
              {mode === 'signs' &&
                prediction &&
                prediction.prob > 0.3 &&
                ` · seeing "${prediction.gloss}" (${(prediction.prob * 100).toFixed(0)}%)`}
              {mode === 'fingerspell' &&
                fs &&
                fs.letter &&
                ` · letter ${fs.letter} (${(fs.prob * 100).toFixed(0)}%)`}
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
