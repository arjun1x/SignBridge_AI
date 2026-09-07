import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ stdin: { contents: `export * from './apps/desktop/src/inference/letterCommitter'; export * from './apps/desktop/src/inference/frameWindow'; export * from './apps/desktop/src/inference/debounce'; export * from './apps/desktop/src/nlp/sentenceAssembler';`, resolveDir: process.cwd() }, bundle:true, write:false, format:'esm', platform:'node' })
const { LetterCommitter, FrameWindow, SentenceAssembler } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
test('high-confidence letters commit by elapsed time; one held pose emits once', () => {
  const c = new LetterCommitter()
  const results = [0,35,70,105,140,175,210,245,280].map((t) => c.push('L',.97,t,.7)).filter(Boolean)
  assert.deepEqual(results,['L'])
})
test('a one-frame competing prediction does not duplicate a held letter', () => {
  const c = new LetterCommitter()
  for (const t of [0,35,70,105]) c.push('L',.99,t,.8)
  c.push('T',.99,140,.8)
  assert.deepEqual([175,210,245,280].map(t=>c.push('L',.99,t,.8)).filter(Boolean),[])
})
test('sustained release permits repeat letters; a short dropout does not', () => {
  const c = new LetterCommitter()
  for (const t of [0,35,70,105]) c.push('L',.99,t,.8)
  c.onHandLost(140)
  assert.equal(c.push('L',.99,175,.8),null)
  c.onHandLost(200); c.onHandLost(400)
  const results = [435,470,505,540].map(t=>c.push('L',.99,t,.8)).filter(Boolean)
  assert.deepEqual(results,['L'])
})
test('uncertain, near-tie, unknown, NaN and motion-letter predictions never append', () => {
  for (const [label,p,m] of [['A',.6,.5],['A',.9,.05],['A',NaN,.5],['nothing',.99,.8],['J',.99,.8],['Z',.99,.8]]) {
    const c = new LetterCommitter()
    assert.deepEqual(Array.from({length:20},(_,i)=>c.push(label,p,i*35,m)).filter(Boolean),[])
  }
})
test('out-of-order timestamps and sparse observations cannot accumulate a hold', () => {
  const c = new LetterCommitter()
  assert.deepEqual([100,100,90,80,700,1400,2100].map(t=>c.push('A',.99,t,.8)).filter(Boolean),[])
})
test('circular windows match start padding and preserve async snapshots', () => {
  const ring = new FrameWindow(3,2)
  ring.push(new Float32Array([1,2]))
  const saved = ring.snapshot()
  assert.deepEqual([...saved.features],[0,0,0,0,1,2]); assert.deepEqual([...saved.mask],[0,0,1])
  for (const pair of [[3,4],[5,6],[7,8]]) ring.push(new Float32Array(pair))
  assert.deepEqual([...ring.snapshot().features],[3,4,5,6,7,8]); assert.deepEqual([...saved.features],[0,0,0,0,1,2])
  ring.reset(); assert.deepEqual([...ring.snapshot().mask],[0,0,0])
})
test('a held hand does not auto-speak until the explicit absence boundary', () => {
  const spoken = []; const assembler = new SentenceAssembler({onBufferChange(){},onSentence:s=>spoken.push(s)},true,500)
  assembler.addGloss('hello')
  assembler.updateRest(false,0); assembler.updateRest(false,5000)
  assert.deepEqual(spoken,[])
  assembler.updateRest(true,6000); assembler.updateRest(true,6500)
  assert.deepEqual(spoken,['hello'])
})
test('MediaPipe loader exports a reusable factory for module-worker GPU/CPU fallback', async () => {
  const {default:factory}=await import('../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js')
  assert.equal(typeof factory,'function')
  // This is a loader check, not a camera/WebGL execution test.
  delete globalThis.ModuleFactory; delete globalThis.custom_dbg
})
