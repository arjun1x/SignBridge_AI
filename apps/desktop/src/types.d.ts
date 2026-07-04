export {}

declare global {
  interface CaptionEvent {
    kind: 'partial' | 'final' | 'state' | 'error'
    text?: string
    running?: boolean
    ts: number
  }

  interface Window {
    signbridge: {
      getStatus(): Promise<{ modelFound: boolean; modelDir: string | null; running: boolean }>
      startCaptions(): Promise<{ ok: boolean; error?: string }>
      stopCaptions(): Promise<{ ok: boolean }>
      onCaption(cb: (ev: CaptionEvent) => void): () => void
      setOverlayInteractive(interactive: boolean): void
      ttsStatus(): Promise<{ modelFound: boolean; ready: boolean }>
      ttsSpeak(text: string, speed?: number): Promise<{ samples: Float32Array; sampleRate: number }>
      authGet(): Promise<UserProfile | null>
      authSignIn(): Promise<{ ok: boolean; profile?: UserProfile; error?: string }>
      authSignOut(): Promise<{ ok: boolean }>
    }
  }

  interface UserProfile {
    name: string
    email: string
    avatar: string | null
  }
}
