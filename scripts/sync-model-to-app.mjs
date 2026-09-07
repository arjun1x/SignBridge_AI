import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2] ?? 'signs_v1'
if (!/^(signs|fingerspell)_v\d+$/.test(name)) throw new Error('Choose a trained signs_vN or fingerspell_vN model')
const fsMode = name.startsWith('fingerspell')
const src = join(root, 'models')
const out = join(root, 'apps/desktop/src/public/models')
const metaPath = join(src, `${name}.meta.json`)
const modelPath = join(src, `${name}.onnx`)
if (!existsSync(metaPath) || !existsSync(modelPath)) throw new Error(`Missing ${name} weights or metadata. Train/export first.`)
const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
if (meta.val_acc == null) throw new Error('Untrained models cannot be installed for recognition')
const labelFile = meta.labels_file ?? (fsMode ? 'labels_fingerspell.json' : 'labels.json')
if (!/^[\w.-]+\.json$/.test(labelFile)) throw new Error('Invalid labels filename')
const packagedLabels = join(src, labelFile)
const fallbackLabels = join(root, 'shared', fsMode ? 'labels_fingerspell.json' : 'labels_gislr.json')
const labelSource = meta.labels_file ? packagedLabels : fallbackLabels
if (!existsSync(labelSource)) throw new Error(`Missing model label map: ${labelSource}`)
const bytes = readFileSync(labelSource)
const labels = JSON.parse(bytes.toString())
const hash = (data) => createHash('sha256').update(data).digest('hex')
if (labels.length !== meta.num_classes || (meta.labels_sha256 && hash(bytes) !== meta.labels_sha256)) throw new Error('Model label map does not match metadata')
const spec = join(root, 'shared', fsMode ? 'fingerspell_spec.json' : 'feature_spec.json')
if (meta[fsMode ? 'fingerspell_spec_sha256' : 'feature_spec_sha256'] !== hash(readFileSync(spec))) throw new Error('Model feature specification is incompatible')
// All inputs validated before publishing metadata (the runtime discovery marker).
mkdirSync(out, { recursive: true })
copyFileSync(modelPath, join(out, `${name}.onnx`))
writeFileSync(join(out, labelFile), bytes)
copyFileSync(metaPath, join(out, `${name}.meta.json`))
console.log(`Synced trained ${name} and its matching labels`)
