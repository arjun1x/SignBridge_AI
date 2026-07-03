// Segments the continuous landmark stream into sign "utterances" using hand
// presence + motion energy: once both hands have been still (or absent) for
// REST_DURATION_MS, the gate fires a segment boundary the sentence
// assembler can use as a natural point to finalize/speak a gloss run.
import { FRAME_FEATURE_DIM } from '../vision/features'

const MOTION_THRESHOLD = 0.015 // mean abs delta over hand columns, normalized feature units
const REST_DURATION_MS = 400
const HAND_COLUMNS_END = 84 // features[0:84) = left_hand + right_hand, see feature_spec.json

export interface GateUpdate {
  motionEnergy: number
  handsPresent: boolean
  isResting: boolean
  justEnteredRest: boolean
}

export class SignGate {
  private prevFeatures: Float32Array | null = null
  private restStartMs: number | null = null
  private wasResting = false

  update(features: Float32Array, timestampMs: number): GateUpdate {
    if (features.length !== FRAME_FEATURE_DIM) {
      throw new Error(`SignGate expected ${FRAME_FEATURE_DIM}-dim features, got ${features.length}`)
    }

    const leftPresent = features[FRAME_FEATURE_DIM - 2] > 0.5
    const rightPresent = features[FRAME_FEATURE_DIM - 1] > 0.5
    const handsPresent = leftPresent || rightPresent

    let motionEnergy = 0
    if (this.prevFeatures && handsPresent) {
      let sum = 0
      for (let i = 0; i < HAND_COLUMNS_END; i++) {
        sum += Math.abs(features[i] - this.prevFeatures[i])
      }
      motionEnergy = sum / HAND_COLUMNS_END
    }
    this.prevFeatures = features

    const settled = !handsPresent || motionEnergy < MOTION_THRESHOLD
    if (settled) {
      if (this.restStartMs === null) this.restStartMs = timestampMs
    } else {
      this.restStartMs = null
    }

    const isResting = this.restStartMs !== null && timestampMs - this.restStartMs >= REST_DURATION_MS
    const justEnteredRest = isResting && !this.wasResting
    this.wasResting = isResting

    return { motionEnergy, handsPresent, isResting, justEnteredRest }
  }

  reset(): void {
    this.prevFeatures = null
    this.restStartMs = null
    this.wasResting = false
  }
}
