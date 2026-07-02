// AudioWorklet: mixes input to mono, linearly resamples from the context rate
// (usually 48 kHz) to 16 kHz, and emits fixed-size chunks (~100 ms) of Float32.
class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    this.target = opts.targetSampleRate || 16000
    this.ratio = sampleRate / this.target
    this.input = new Float32Array(0)
    this.readPos = 0
    const chunkSamples = Math.round(((opts.chunkMs || 100) / 1000) * this.target)
    this.out = new Float32Array(chunkSamples)
    this.outLen = 0
  }

  process(inputs) {
    const channels = inputs[0]
    if (!channels || !channels[0] || channels[0].length === 0) return true

    const n = channels[0].length
    const mono = new Float32Array(n)
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c]
      for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length
    }

    const merged = new Float32Array(this.input.length + n)
    merged.set(this.input)
    merged.set(mono, this.input.length)
    this.input = merged

    while (this.readPos + 1 < this.input.length) {
      const i = Math.floor(this.readPos)
      const frac = this.readPos - i
      this.out[this.outLen++] = this.input[i] * (1 - frac) + this.input[i + 1] * frac
      this.readPos += this.ratio
      if (this.outLen === this.out.length) {
        this.port.postMessage({ sampleRate: this.target, samples: this.out.slice(0) })
        this.outLen = 0
      }
    }

    const consumed = Math.floor(this.readPos)
    this.input = this.input.slice(consumed)
    this.readPos -= consumed
    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
