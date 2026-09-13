// Feature detection for the public web build. Everything the recognition path
// needs is checked up front so a visitor on an unsupported device gets a plain
// explanation instead of a failure halfway through. Optional features degrade.
export interface Capability {
  ok: boolean
  reason?: string
}

export interface Capabilities {
  /** Hard requirements for the core sign → text → voice path. */
  secureContext: Capability
  camera: Capability
  webAssembly: Capability
  worker: Capability
  offscreenCanvas: Capability
  webgl: Capability
  /** Optional: better speed or extra features. */
  threads: Capability
  webgpu: Capability
  speech: Capability
  outputRouting: Capability
  systemAudioCapture: Capability
  pictureInPicture: Capability
  /** Summary flags. */
  coreSupported: boolean
  blockers: string[]
  limitations: string[]
}

const yes: Capability = { ok: true }
const no = (reason: string): Capability => ({ ok: false, reason })

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export function detectCapabilities(): Capabilities {
  const md = navigator.mediaDevices
  const isChromium = /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent) && !/OPR\//.test(navigator.userAgent)
  const isWindows = /Windows/.test(navigator.userAgent)

  const c: Omit<Capabilities, 'coreSupported' | 'blockers' | 'limitations'> = {
    secureContext: window.isSecureContext ? yes : no('This page must be opened over HTTPS (or localhost) to use the camera.'),
    camera: md && typeof md.getUserMedia === 'function' ? yes : no('This browser does not offer camera access.'),
    webAssembly: typeof WebAssembly === 'object' ? yes : no('WebAssembly is not available; recognition cannot run here.'),
    worker: typeof Worker === 'function' ? yes : no('Web Workers are not available.'),
    offscreenCanvas: typeof OffscreenCanvas === 'function' ? yes : no('This browser is too old for in-worker tracking (no OffscreenCanvas).'),
    webgl: webglAvailable() ? yes : no('WebGL is disabled or unavailable; hand tracking needs it.'),
    threads: window.crossOriginIsolated ? yes : no('Multi-threaded inference is off (page is not cross-origin isolated); recognition still works, just slower.'),
    webgpu: 'gpu' in navigator ? yes : no('No WebGPU; the sign classifier will use the CPU (wasm) path.'),
    speech: 'speechSynthesis' in window ? yes : no('No speech synthesis; recognized text is shown but not spoken.'),
    outputRouting: 'setSinkId' in HTMLMediaElement.prototype && isChromium
      ? yes
      : no('Routing the voice into a call (virtual cable) needs Chrome or Edge.'),
    systemAudioCapture: md && typeof md.getDisplayMedia === 'function' && isChromium && isWindows
      ? yes
      : no('Live call captions need Chrome or Edge on Windows, which can share system audio.'),
    pictureInPicture: 'documentPictureInPicture' in window
      ? yes
      : no('A floating caption window needs Chrome or Edge 116+; captions will show on this page instead.')
  }

  const hard: (keyof typeof c)[] = ['secureContext', 'camera', 'webAssembly', 'worker', 'offscreenCanvas', 'webgl']
  const soft: (keyof typeof c)[] = ['threads', 'webgpu', 'speech', 'outputRouting', 'systemAudioCapture', 'pictureInPicture']
  const blockers = hard.filter((k) => !c[k].ok).map((k) => c[k].reason!)
  const limitations = soft.filter((k) => !c[k].ok).map((k) => c[k].reason!)
  return { ...c, coreSupported: blockers.length === 0, blockers, limitations }
}
