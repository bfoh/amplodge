import type { FrameSet } from './frames.generated'

/**
 * One clip of the arrival film as a scroll-scrubbed image sequence.
 *
 * Frames load coarse-to-fine (every 8th, then every 4th, 2nd, 1st), so a clip
 * can be scrubbed after about an eighth of its bytes have arrived. Drawing
 * always uses the nearest frame that has loaded, so scrubbing never waits and
 * never shows a blank. Frames are plain <img> elements: the browser keeps them
 * compressed and decodes on demand, so six clips never hold hundreds of
 * megabytes of bitmaps.
 */
export class FrameSequence {
  private readonly frames: (HTMLImageElement | null)[]
  private readonly ctx: CanvasRenderingContext2D | null
  private progress = 0
  private drawn = -1
  private disposed = false
  private loading: Promise<void> | null = null
  private ready = false

  /** Called once, when the first frame can be drawn. */
  onReady: (() => void) | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly base: string,
    private readonly set: FrameSet,
    private readonly prefix: 'd' | 'm',
    /** Horizontal focal point (0–1) kept in view when the canvas is narrower than the frame. */
    private readonly focusX = 0.5,
    private readonly focusY = 0.5,
  ) {
    this.frames = new Array(set.count).fill(null)
    this.ctx = canvas.getContext('2d', { alpha: false })
  }

  get isReady() {
    return this.ready
  }

  private url(i: number) {
    return `${this.base}/${this.prefix}-${String(i + 1).padStart(3, '0')}.webp`
  }

  /** Loads every frame, coarse first. Safe to call more than once. */
  load(concurrency = 4): Promise<void> {
    if (this.loading) return this.loading
    const order: number[] = []
    const seen = new Set<number>()
    for (const step of [8, 4, 2, 1]) {
      for (let i = 0; i < this.set.count; i += step) {
        if (!seen.has(i)) {
          seen.add(i)
          order.push(i)
        }
      }
    }
    if (!seen.has(this.set.count - 1)) order.splice(1, 0, this.set.count - 1)

    let next = 0
    const worker = async () => {
      while (!this.disposed && next < order.length) {
        const i = order[next++]
        const img = new Image()
        img.decoding = 'async'
        img.src = this.url(i)
        try {
          await img.decode()
        } catch {
          continue // a missing frame is skipped; its neighbours stand in
        }
        if (this.disposed) return
        this.frames[i] = img
        if (!this.ready) {
          this.ready = true
          this.resize()
          this.onReady?.()
        } else if (this.drawn !== this.target()) {
          this.draw()
        }
      }
    }
    this.loading = Promise.all(Array.from({ length: concurrency }, worker)).then(() => undefined)
    return this.loading
  }

  /** 0–1 through the clip. */
  setProgress(p: number) {
    this.progress = Math.min(1, Math.max(0, p))
    if (this.ready && this.target() !== this.drawn) this.draw()
  }

  /** Match the backing store to the canvas's CSS size (capped at 1.5× for cost). */
  resize() {
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const k = Math.min(window.devicePixelRatio || 1, 1.5)
    const w = Math.round(rect.width * k)
    const h = Math.round(rect.height * k)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.drawn = -1
    if (this.ready) this.draw()
  }

  private target() {
    return Math.round(this.progress * (this.set.count - 1))
  }

  private nearest(i: number): HTMLImageElement | null {
    for (let d = 0; d < this.set.count; d++) {
      const a = this.frames[i - d]
      if (a) return a
      const b = this.frames[i + d]
      if (b) return b
    }
    return null
  }

  private draw() {
    const ctx = this.ctx
    if (!ctx || this.disposed) return
    const i = this.target()
    const img = this.nearest(i)
    if (!img) return
    const cw = this.canvas.width
    const ch = this.canvas.height
    const iw = img.naturalWidth || this.set.w
    const ih = img.naturalHeight || this.set.h
    // object-fit: cover around the focal point
    const scale = Math.max(cw / iw, ch / ih)
    const sw = cw / scale
    const sh = ch / scale
    const sx = Math.min(iw - sw, Math.max(0, iw * this.focusX - sw / 2))
    const sy = Math.min(ih - sh, Math.max(0, ih * this.focusY - sh / 2))
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch)
    this.drawn = this.frames[i] ? i : -1
  }

  dispose() {
    this.disposed = true
    for (const img of this.frames) if (img) img.src = ''
    this.frames.fill(null)
  }
}
