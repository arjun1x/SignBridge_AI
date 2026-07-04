// Downloads the sherpa-onnx Piper TTS voice (en_US amy, low quality tier —
// small and fast, clearly intelligible) into apps/desktop/resources/tts/.
// This engine produces raw PCM we can route to any output device (VB-Cable),
// which speechSynthesis cannot do. Model binaries are never committed.
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { spawnSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const MODEL = 'vits-piper-en_US-amy-low'
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL}.tar.bz2`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ttsDir = join(root, 'apps', 'desktop', 'resources', 'tts')
const modelDir = join(ttsDir, MODEL)
const tarball = join(ttsDir, `${MODEL}.tar.bz2`)

if (existsSync(join(modelDir, 'tokens.txt'))) {
  console.log(`Model already present: ${modelDir}`)
  process.exit(0)
}

mkdirSync(ttsDir, { recursive: true })
console.log(`Downloading ${URL} (~65 MB)`)

const res = await fetch(URL, { redirect: 'follow' })
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(tarball))

console.log('Extracting...')
const tar = spawnSync('tar', ['-xjf', tarball, '-C', ttsDir], { stdio: 'inherit' })
if (tar.status !== 0) {
  console.error('tar extraction failed')
  process.exit(1)
}
rmSync(tarball)
console.log(`Done: ${modelDir}`)
