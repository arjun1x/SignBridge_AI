// Time-based evidence is independent of camera/display refresh rate.
export interface LetterCommitterConfig {
  minProb: number; minMargin: number; stableMs: number; fastMs: number
  fastProb: number; releaseMs: number; minSamples: number
}
export const DEFAULT_LETTER_CONFIG: LetterCommitterConfig = {
  minProb: 0.72, minMargin: 0.18, stableMs: 140, fastMs: 85,
  fastProb: 0.94, releaseMs: 180, minSamples: 3
}
export class LetterCommitter {
  private candidate = ''
  private since = 0
  private samples = 0
  private lastCommitted = ''
  private releaseSince: number | null = null
  private previousTs = -Infinity
  private allFast = true
  constructor(private config: LetterCommitterConfig = DEFAULT_LETTER_CONFIG) {}
  push(letter: string, prob: number, nowMs = performance.now(), margin = 1): string | null {
    if (nowMs <= this.previousTs) return null
    if (nowMs - this.previousTs > 300) this.clearCandidate()
    this.previousTs = nowMs
    // Static inputs cannot recognize motion letters. Do not invent J or Z.
    const valid = /^[A-Z]$/.test(letter) || letter === 'space' || letter === 'del'
    if (!valid || letter === 'J' || letter === 'Z' || !Number.isFinite(prob) ||
        !Number.isFinite(margin) || prob < this.config.minProb || margin < this.config.minMargin) {
      this.release(nowMs)
      return null
    }
    this.releaseSince = null
    if (letter !== this.candidate) {
      this.candidate = letter; this.since = nowMs; this.samples = 0; this.allFast = true
    }
    this.samples++
    this.allFast &&= prob >= this.config.fastProb
    const hold = letter.length > 1 ? 350 : this.allFast ? this.config.fastMs : this.config.stableMs
    if (this.samples >= this.config.minSamples && nowMs - this.since >= hold && letter !== this.lastCommitted) {
      this.lastCommitted = letter
      return letter
    }
    return null
  }
  private clearCandidate(): void { this.candidate = ''; this.samples = 0; this.allFast = true }
  private release(nowMs: number): void {
    this.clearCandidate(); this.releaseSince ??= nowMs
    if (nowMs - this.releaseSince >= this.config.releaseMs) this.lastCommitted = ''
  }
  onHandLost(nowMs = performance.now()): void { this.release(nowMs) }
  reset(): void {
    this.clearCandidate(); this.lastCommitted = ''; this.releaseSince = null; this.previousTs = -Infinity
  }
}
