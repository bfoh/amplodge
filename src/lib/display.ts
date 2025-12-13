// Utility display helpers for PMS
export function getRoomDisplayName(property: any): string {
  // Prefer room-level naming when available; fall back to common fields
  return (
    property?.roomNumber ||
    property?.roomName ||
    property?.unitName ||
    property?.title ||
    property?.name ||
    'Room'
  )
}

// Calculate number of nights between check-in (inclusive) and check-out (exclusive)
// Uses local calendar days to avoid timezone off-by-one errors
export function calculateNights(checkIn: string | Date, checkOut: string | Date): number {
  const toLocalStart = (d: string | Date) => {
    const x = typeof d === 'string' ? new Date(d) : new Date(d)
    return new Date(x.getFullYear(), x.getMonth(), x.getDate())
  }
  const inStart = toLocalStart(checkIn)
  const outStart = toLocalStart(checkOut)
  const MS_PER_DAY = 1000 * 60 * 60 * 24
  const diff = (outStart.getTime() - inStart.getTime()) / MS_PER_DAY
  // Nights can be zero if invalid; let caller validate separately
  return Math.max(0, Math.round(diff))
}
