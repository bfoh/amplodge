/** Stand-in for pdfkit: every drawing call chains, and end() finishes the stream. */
export default class PDFDocument {
  private handlers: Record<string, Array<(arg?: any) => void>> = {}
  y = 0
  constructor() {
    return new Proxy(this, {
      get: (target, prop) => (prop in target ? (target as any)[prop] : () => target),
    })
  }
  on(event: string, cb: (arg?: any) => void) {
    ;(this.handlers[event] ||= []).push(cb)
    return this
  }
  end() {
    this.handlers.data?.forEach((cb) => cb(new Uint8Array([37, 80, 68, 70])))
    this.handlers.end?.forEach((cb) => cb())
  }
}
