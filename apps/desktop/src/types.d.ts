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
    }
  }
}
