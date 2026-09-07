import { useEffect, useRef, useState } from 'react'
import {
  backspaceGloss, clearGlossBuffer, commitWord, setAutoSpeak, setSignMode,
  speakNow, startSignPipeline, stopSignPipeline, appendLetter,
  type ModelInfo, type SignMode, type SignPipelineStatus, type FingerspellState
} from '../vision/signPipeline'
import { speak, cancelSpeech } from '../tts/ttsService'

const CONNECTIONS = [[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]]
export function SignPractice() {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'running'>('idle')
  const [mode, setMode] = useState<SignMode>('fingerspell')
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [status, setStatus] = useState<SignPipelineStatus | null>(null)
  const [fs, setFs] = useState<FingerspellState | null>(null)
  const [prediction, setPrediction] = useState<{ gloss: string; prob: number } | null>(null)
  const [buffer, setBuffer] = useState<string[]>([])
  const [spoken, setSpoken] = useState<string[]>([])
  const [autoSpeak, toggleSpeak] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { stopSignPipeline(); cancelSpeech() }, [])
  const running = state === 'running'
  const hasText = buffer.length > 0 || Boolean(fs?.word)
  function drawHands(hands: number[][]) {
    const target = canvas.current; const player = video.current
    if (!target || !player) return
    target.width = player.videoWidth || 640; target.height = player.videoHeight || 480
    const ctx = target.getContext('2d'); if (!ctx) return
    ctx.clearRect(0, 0, target.width, target.height)
    ctx.strokeStyle = '#70ffd6'; ctx.lineWidth = 2.4; ctx.fillStyle = '#fff'
    for (const hand of hands) {
      for (const path of CONNECTIONS) {
        ctx.beginPath()
        path.forEach((index, i) => {
          const x = hand[index * 3] * target.width; const y = hand[index * 3 + 1] * target.height
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y)
        })
        ctx.stroke()
      }
      for (let i = 0; i < 21; i++) {
        ctx.beginPath(); ctx.arc(hand[i * 3] * target.width, hand[i * 3 + 1] * target.height, 3.4, 0, Math.PI * 2); ctx.fill()
      }
    }
  }
  async function start() {
    if (!video.current || state !== 'idle') return
    setError(''); setModel(null); setStatus(null); setFs(null); setBuffer([])
    await startSignPipeline(video.current, {
      onState: (next) => { setState(next); if (next === 'idle') { setStatus(null); setFs(null); setBuffer([]); setModel(null); setPrediction(null) } },
      onReady: setModel, onStatus: setStatus, onFingerspell: setFs,
      onPrediction: setPrediction, onGlossBuffer: setBuffer,
      onSentence: (sentence) => { setSpoken((old) => [...old.slice(-19), sentence]); speak(sentence) },
      onError: setError, onLandmarks: drawHands
    }, { mode, autoSpeak })
  }
  async function switchMode(next: SignMode) {
    if (next === mode) return
    setMode(next); setError(''); setModel(null); setStatus(null); setFs(null); setPrediction(null)
    await setSignMode(next)
  }
  const label = mode === 'fingerspell' ? fs?.letter : prediction?.gloss
  const confidence = mode === 'fingerspell' ? fs?.prob ?? 0 : prediction?.prob ?? 0
  const uncertain = mode === 'fingerspell' ? fs?.uncertain !== false : confidence < 0.6
  return <section className="studio card" id="studio" aria-labelledby="studio-title">
    <div className="section-heading"><div><p className="eyebrow">01 / YOUR EXPRESSION</p><h2 id="studio-title">Signing studio</h2></div>
      <span className={`pill ${running ? 'pill-on' : ''}`}>{state === 'loading' ? 'Preparing recognition…' : running ? 'Camera on' : 'Camera off'}</span>
    </div>
    <div className="studio-toolbar">
      <div className="mode-toggle" role="group" aria-label="Recognition mode">
        <button aria-pressed={mode === 'fingerspell'} onClick={() => switchMode('fingerspell')} disabled={state === 'loading'}>Aa <span>Fingerspell</span></button>
        <button aria-pressed={mode === 'signs'} onClick={() => switchMode('signs')} disabled={state === 'loading'}>✧ <span>ASL signs</span></button>
      </div>
      <span className="small">{mode === 'fingerspell' ? 'One hand. One letter at a time.' : 'Keep your hands and upper body in view.'}</span>
    </div>
    {error && <p className="warn" role="alert">{error}</p>}
    <div className="studio-grid">
      <div className="camera-stage">
        <video ref={video} muted playsInline aria-label="Mirrored camera preview" />
        <canvas ref={canvas} className="landmarks" aria-hidden="true" />
        <div className="camera-corners" aria-hidden="true" />
        {state !== 'idle' && <span className="camera-label">{status?.handsPresent ? 'HAND TRACKED' : state === 'loading' ? 'LOADING' : 'SHOW YOUR HAND'}</span>}
        {!running && <div className="camera-empty">
          <div className="camera-symbol" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="8" y="17" width="33" height="30" rx="8"/><path d="m41 28 15-9v27l-15-9"/></svg></div>
          <h3>{state === 'loading' ? 'Getting ready for your hands…' : 'Your next conversation starts here.'}</h3>
          <p>{state === 'loading' ? 'Loading your local recognition model.' : 'Find some light, bring your hand into view, and make yourself heard.'}</p>
          {state === 'idle' && <button onClick={start}>Start camera <span aria-hidden="true">↗</span></button>}
        </div>}
        <div className="camera-footer"><span>◈ Camera frames stay on this device</span>
          {state !== 'idle' && <button className="stop-button" onClick={stopSignPipeline}>{state === 'loading' ? 'Cancel' : 'Stop camera'}</button>}
        </div>
      </div>
      <aside className="recognition-panel" aria-label="Recognition result">
        <p className="eyebrow">{mode === 'fingerspell' ? 'CURRENT LETTER' : 'CURRENT SIGN'}</p>
        <div className={`recognized-label ${uncertain ? 'uncertain' : ''}`}>{running && status?.handsPresent && label && label !== 'nothing' ? label : '—'}</div>
        <p className="recognition-hint">{!running ? 'Ready when you are' : !status?.handsPresent ? 'Bring your hand into view' : uncertain ? ['J','Z'].includes(label ?? '') ? 'This letter needs movement' : 'Adjust your hand; prediction uncertain' : 'Hold briefly to add it'}</p>
        <div className="confidence-label"><span>Model confidence</span><strong>{running && status?.handsPresent ? `${Math.round(confidence * 100)}%` : '—'}</strong></div>
        <meter min="0" max="1" value={running && status?.handsPresent ? confidence : 0} aria-label="Model confidence" />
        <p className="small confidence-note">Confidence is a model score, not a guarantee.</p>
        <div className="live-metrics"><div><strong>{status ? Math.round(status.fps) : '—'}</strong><span>processed fps</span></div><div title={status?.backend}><strong>{status ? Math.round(status.latencyMs) : '—'}<small>{status ? ' ms' : ''}</small></strong><span>frame processing</span></div></div>
        <p className="small">{model ? `${model.name} · on device` : 'A trained model is required'}</p>
      </aside>
    </div>
    <div className="sentence-area">
      <div className="sentence-title"><span className="eyebrow">YOUR WORDS</span><label className="switch-label"><input className="switch" type="checkbox" checked={autoSpeak} onChange={(e) => { toggleSpeak(e.target.checked); setAutoSpeak(e.target.checked) }} />Speak after hands leave view</label></div>
      <p className={`sentence ${hasText ? '' : 'muted'}`} aria-live="polite" aria-atomic="true">{hasText ? <>{buffer.join(' ')} <span className="current-word">{fs?.word}</span></> : 'Your words will take shape here.'}</p>
      <div className="sentence-actions">
        <button onClick={speakNow} disabled={!hasText || !running}>Speak aloud</button>
        {mode === 'fingerspell' && <button className="secondary" onClick={commitWord} disabled={!fs?.word || !running}>Add space</button>}
        <button className="text-button" onClick={backspaceGloss} disabled={!hasText || !running}>⌫ Backspace</button>
        <button className="text-button" onClick={clearGlossBuffer} disabled={!hasText || !running}>Clear</button>
      </div>
      <p className="small">{mode === 'fingerspell' ? 'Hold a letter to add it. Relax your hand briefly to repeat a letter. Lower your hand to finish a word.' : 'Recognized signs are joined in signing order; they are not a translation of full ASL grammar.'}</p>
      {mode === 'fingerspell' && <div className="motion-letter-note"><span>J and Z need motion. Add them manually:</span><button className="secondary" disabled={!running} onClick={() => appendLetter('J')} aria-label="Add letter J">J</button><button className="secondary" disabled={!running} onClick={() => appendLetter('Z')} aria-label="Add letter Z">Z</button></div>}
      {spoken.length > 0 && <p className="last-spoken"><span>LAST SPOKEN</span> {spoken.at(-1)}</p>}
    </div>
  </section>
}
