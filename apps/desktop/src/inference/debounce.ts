// Turns the raw per-window prediction stream (one every 8 frames, noisy)
// into a clean gloss stream: a gloss is emitted only when the same top-1
// wins `minConsecutive` windows in a row above `minProb`, and it differs
// from the last emitted gloss. A rest boundary (hands down, see gating.ts)
// clears the last-emitted memory so the same sign can be produced twice in
// a row across a pause ("MOTHER ... MOTHER").
export interface DebounceConfig {
  minProb: number
  minConsecutive: number
}

export const DEFAULT_DEBOUNCE: DebounceConfig = { minProb: 0.6, minConsecutive: 3 }

export interface RawPrediction {
  gloss: string
  prob: number
  ts: number
}

export class GlossDebouncer {
  private candidate: string | null = null
  private streak = 0
  private lastEmitted: string | null = null

  constructor(private config: DebounceConfig = DEFAULT_DEBOUNCE) {}

  /** Returns a gloss to emit, or null. */
  push(pred: RawPrediction): string | null {
    if (pred.prob < this.config.minProb) {
      this.candidate = null
      this.streak = 0
      return null
    }

    if (pred.gloss === this.candidate) {
      this.streak++
    } else {
      this.candidate = pred.gloss
      this.streak = 1
    }

    if (this.streak >= this.config.minConsecutive && this.candidate !== this.lastEmitted) {
      this.lastEmitted = this.candidate
      return this.candidate
    }
    return null
  }

  /** Call at a rest boundary: allows re-emitting the same gloss after a pause. */
  onRest(): void {
    this.candidate = null
    this.streak = 0
    this.lastEmitted = null
  }

  reset(): void {
    this.onRest()
  }
}
