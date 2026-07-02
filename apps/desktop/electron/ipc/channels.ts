export const Channels = {
  captionsStatus: 'captions:status',
  captionsStart: 'captions:start',
  captionsStop: 'captions:stop',
  captionsEvent: 'captions:event',
  captionsPcmPort: 'captions:pcm-port',
  overlaySetInteractive: 'overlay:set-interactive'
} as const

export interface CaptionEvent {
  kind: 'partial' | 'final' | 'state' | 'error'
  text?: string
  running?: boolean
  ts: number
}
