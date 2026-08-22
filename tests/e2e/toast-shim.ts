const noop: any = () => {}
export const toast: any = Object.assign(noop, { success: noop, error: noop, info: noop, warning: noop, loading: noop, dismiss: noop })
export const Toaster: any = () => null
export default { toast, Toaster }
