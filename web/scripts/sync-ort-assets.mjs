// Copies the onnxruntime-web wasm runtime into vendor/ort so the app can
// import it through Vite's asset pipeline (works in dev and build, no CDN).
// Runs automatically before `dev` and `build`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// Prefer the copy nested under @huggingface/transformers so the assets match
// the exact version transformers.js links against; fall back to a hoisted one.
const candidates = [
  join(projectRoot, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'dist'),
  join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist'),
]
const ortDist = candidates.find((path) => existsSync(path))
if (!ortDist) {
  throw new Error('onnxruntime-web is not installed; run npm install first.')
}

// The threaded build ships several flavors; transformers.js uses the plain
// one on Safari and the asyncify one everywhere else. WebGPU is part of the
// same unified builds.
const assets = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
]

const targetDir = join(projectRoot, 'vendor', 'ort')
mkdirSync(targetDir, { recursive: true })

for (const name of assets) {
  const source = join(ortDist, name)
  if (!existsSync(source)) {
    throw new Error(`Expected ORT asset missing: ${source}`)
  }
  copyFileSync(source, join(targetDir, name))
}

console.log(`Synced ${assets.length} ONNX Runtime assets to vendor/ort`)
