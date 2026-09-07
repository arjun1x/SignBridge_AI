export type SignMode = 'signs' | 'fingerspell'
export interface ModelInfo { name: string; valAcc: number | null; testMode: boolean; mode: SignMode }
export interface Candidate { label: string; prob: number }
export interface Prediction {
  label: string; prob: number; margin: number; alternatives: Candidate[]; ts: number
}
export type WorkerRequest =
  | { type: 'load'; mode: SignMode; base: string; labelsUrl: string }
  | { type: 'frame'; bitmap: ImageBitmap; capturedAt: number }
export type WorkerReply =
  | { type: 'ready'; model: ModelInfo; backend: string }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'frame'; capturedAt: number; hands: number[][]; handsPresent: boolean;
      prediction?: Prediction; landmarkMs: number; inferenceMs: number; motionEnergy: number; isResting: boolean }
