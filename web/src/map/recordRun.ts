// Recording the animation. The map draws to a canvas, so the frames can be taken from it
// without any help from the server: each frame is the map copied onto a 1920 by 1080
// canvas with the overlays painted on top, and that canvas is recorded as a WebM file.

import { cover } from './videoFrame'

export interface RecordOptions {
  /** The map's own canvas. The map must be created with preserveDrawingBuffer. */
  source: HTMLCanvasElement
  width?: number
  height?: number
  fps?: number
  /** Paint the overlays for this frame. */
  drawOverlay: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
  /** True once the run has finished. */
  isDone: () => boolean
}

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

function bestMimeType(): string | undefined {
  for (const type of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return undefined
}

export function recordRun(options: RecordOptions): Promise<Blob> {
  const width = options.width ?? 1920
  const height = options.height ?? 1080
  const fps = options.fps ?? 30

  const frame = document.createElement('canvas')
  frame.width = width
  frame.height = height
  const ctx = frame.getContext('2d')
  if (!ctx) return Promise.reject(new Error('This browser cannot draw the video frames.'))

  const stream = frame.captureStream(fps)
  const recorder = new MediaRecorder(stream, { mimeType: bestMimeType(), videoBitsPerSecond: 8_000_000 })
  const parts: Blob[] = []
  recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data) }

  return new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('The recording stopped unexpectedly.'))
    recorder.onstop = () => resolve(new Blob(parts, { type: 'video/webm' }))

    let handle = 0
    const paint = () => {
      const { scale, x, y } = cover(options.source.width, options.source.height, width, height)
      ctx.fillStyle = '#07070a'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(options.source, x, y, options.source.width * scale, options.source.height * scale)
      options.drawOverlay(ctx, width, height)
      if (options.isDone()) {
        cancelAnimationFrame(handle)
        recorder.stop()
        return
      }
      handle = requestAnimationFrame(paint)
    }

    recorder.start()
    handle = requestAnimationFrame(paint)
  })
}
