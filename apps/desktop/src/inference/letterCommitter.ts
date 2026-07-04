// Fingerspelling letter commit: per-frame letter predictions are noisy while
// the hand transitions between poses, so a letter is committed only after it
// has been the stable top-1 (above minProb) for stableFrames consecutive
// frames. After a commit, the SAME letter can't recommit until the hand
// breaks the pose (a different letter wins or the hand leaves the frame) —
// so "LL" is spelled by relaxing the hand briefly between the two L's,
// standard fingerspelling-recognizer UX.
export interface LetterCommitterConfig {
  minProb: number
  stableFrames: number
}

export const DEFAULT_LETTER_CONFIG: LetterCommitterConfig = { minProb: 0.7, stableFrames: 8 }

export class LetterCommitter {
  private candidate: string | null = null
  private streak = 0
  private lastCommitted: string | null = null

  constructor(private config: LetterCommitterConfig = DEFAULT_LETTER_CONFIG) {}

  /** Feed one per-frame prediction; returns a letter to commit or null. */
  push(letter: string, prob: number): string | null {
    if (prob < this.config.minProb) {
      this.candidate = null
      this.streak = 0
      return null
    }

    if (letter === this.candidate) {
      this.streak++
    } else {
      this.candidate = letter
      this.streak = 1
      // Pose broke to something else — allow the previous letter again later.
      if (letter !== this.lastCommitted) this.lastCommitted = null
    }

    if (this.streak >= this.config.stableFrames && this.candidate !== this.lastCommitted) {
      this.lastCommitted = this.candidate
      return this.candidate
    }
    return null
  }

  /** Call when no hand is in frame — breaks the pose for repeat letters. */
  onHandLost(): void {
    this.candidate = null
    this.streak = 0
    this.lastCommitted = null
  }

  reset(): void {
    this.onHandLost()
  }
}
