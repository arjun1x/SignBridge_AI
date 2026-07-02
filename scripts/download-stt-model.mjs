// Downloads the sherpa-onnx streaming Zipformer English model into
// apps/desktop/resources/stt/. Model binaries are never committed to git.
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { spawnSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const MODEL = 'sherpa-onnx-streaming-zipformer-en-2023-06-26'
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL}.tar.bz2`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sttDir = join(root, 'apps', 'desktop', 'resources', 'stt')
const modelDir = join(sttDir, MODEL)
const tarball = join(sttDir, `${MODEL}.tar.bz2`)

if (existsSync(join(modelDir, 'tokens.txt'))) {
  console.log(`Model already present: ${modelDir}`)
  process.exit(0)
}

mkdirSync(sttDir, { recursive: true })

console.log(`Downloading ${URL}`)
console.log('(~300 MB, this can take a few minutes...)')

const res = await fetch(URL, { redirect: 'follow' })
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}

const total = Number(res.headers.get('content-length') ?? 0)
let received = 0
let lastLogged = 0

const body = Readable.fromWeb(res.body)
body.on('data', (chunk) => {
  received += chunk.length
  if (received - lastLogged > 25 * 1024 * 1024) {
    lastLogged = received
    const pct = total ? ` (${Math.round((received / total) * 100)}%)` : ''
    console.log(`  ${(received / 1024 / 1024).toFixed(0)} MB${pct}`)
  }
})
await pipeline(body, createWriteStream(tarball))
console.log('Download complete, extracting...')

// Windows 10+ ships bsdtar, which handles .tar.bz2
const tar = spawnSync('tar', ['-xjf', tarball, '-C', sttDir], { stdio: 'inherit' })
if (tar.status !== 0) {
  console.error('tar extraction failed')
  process.exit(1)
}

rmSync(tarball)
console.log(`Done: ${modelDir}`)
