// Collects debounced glosses into a sentence buffer and decides when to
// finalize ("speak"): either explicitly (user hits Speak) or automatically
// after the signer rests for `autoSpeakAfterMs`. v1 output is a plain
// gloss join — ASL gloss order is not English grammar; that limitation is
// documented in the README and a cleanup pass is a later stretch goal.
export interface AssemblerCallbacks {
  onBufferChange: (glosses: string[]) => void
  onSentence: (sentence: string) => void
}

export class SentenceAssembler {
  private buffer: string[] = []
  private restSinceMs: number | null = null

  constructor(
    private callbacks: AssemblerCallbacks,
    private autoSpeak = true,
    private autoSpeakAfterMs = 2000
  ) {}

  addGloss(gloss: string): void {
    this.buffer.push(gloss)
    this.callbacks.onBufferChange([...this.buffer])
  }

  /** Feed the gate's rest state every frame; drives auto-speak. */
  updateRest(isResting: boolean, nowMs: number): void {
    if (!isResting) {
      this.restSinceMs = null
      return
    }
    if (this.restSinceMs === null) this.restSinceMs = nowMs
    if (this.autoSpeak && this.buffer.length > 0 && nowMs - this.restSinceMs >= this.autoSpeakAfterMs) {
      this.speak()
    }
  }

  setAutoSpeak(enabled: boolean): void {
    this.autoSpeak = enabled
  }

  /** Finalize the current buffer into a sentence (no-op when empty). */
  speak(): void {
    if (this.buffer.length === 0) return
    const sentence = this.buffer.join(' ').toLowerCase()
    this.buffer = []
    this.restSinceMs = null
    this.callbacks.onBufferChange([])
    this.callbacks.onSentence(sentence)
  }

  backspace(): void {
    this.buffer.pop()
    this.callbacks.onBufferChange([...this.buffer])
  }

  clear(): void {
    this.buffer = []
    this.restSinceMs = null
    this.callbacks.onBufferChange([])
  }
}
