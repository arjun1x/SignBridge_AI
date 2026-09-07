// O(feature_dim) insertion; immutable snapshot only when inference runs.
export class FrameWindow {
  private data: Float32Array
  private cursor = 0
  private count = 0
  constructor(readonly frames: number, readonly dim: number) { this.data = new Float32Array(frames * dim) }
  push(features: Float32Array): void {
    if (features.length !== this.dim) throw new Error('Incorrect frame feature dimension')
    this.data.set(features, this.cursor * this.dim)
    this.cursor = (this.cursor + 1) % this.frames
    this.count = Math.min(this.count + 1, this.frames)
  }
  snapshot(): { features: Float32Array; mask: Uint8Array } {
    const features = new Float32Array(this.data.length)
    const mask = new Uint8Array(this.frames)
    const start = (this.cursor - this.count + this.frames) % this.frames
    for (let i = 0; i < this.count; i++) {
      const source = ((start + i) % this.frames) * this.dim
      const dest = this.frames - this.count + i
      features.set(this.data.subarray(source, source + this.dim), dest * this.dim)
      mask[dest] = 1
    }
    return { features, mask }
  }
  reset(): void { this.data.fill(0); this.cursor = 0; this.count = 0 }
}
