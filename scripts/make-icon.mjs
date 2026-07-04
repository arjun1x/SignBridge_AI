// Renders apps/desktop/resources/icon.svg to PNG sizes and a Windows .ico
// (electron-builder wants >= 256px). Run after changing the SVG:
//   node scripts/make-icon.mjs
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resDir = join(root, 'apps', 'desktop', 'resources')
const svg = join(resDir, 'icon.svg')

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = []
for (const size of sizes) {
  const buf = await sharp(svg, { density: 72 * (size / 512) * 8 })
    .resize(size, size)
    .png()
    .toBuffer()
  pngs.push(buf)
}

// 512px master PNG (linux builds / README use)
writeFileSync(join(resDir, 'icon.png'), await sharp(svg).resize(512, 512).png().toBuffer())
writeFileSync(join(resDir, 'icon.ico'), await pngToIco(pngs))
console.log(`Wrote ${join(resDir, 'icon.png')} and icon.ico (${sizes.join(', ')}px)`)
