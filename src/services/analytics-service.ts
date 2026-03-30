import { blink } from '@/blink/client'
import { bookingEngine } from './booking-engine'
import { startOfWeek, endOfWeek, endOfMonth, endOfYear } from 'date-fns'
import { standaloneSalesService } from './standalone-sales-service'
import type {
  RevenueAnalytics,
  OccupancyAnalytics,
  GuestAnalytics,
  PerformanceMetrics,
  FinancialAnalytics
} from '@/types/analytics'

/** Decode payment method stored in charge notes as <!-- CHARGE_PAY:method --> */
function decodeChargePaymentMethod(rawNotes: string | undefined | null): string {
  if (!rawNotes) return ''
  const match = (rawNotes as string).match(/<!-- CHARGE_PAY:(.*?) -->/)
  return match?.[1] || ''
}

class AnalyticsService {
  /**
   * Calculate comprehensive revenue analytics
   */
  async getRevenueAnalytics(
    startDate?: Date,
    endDate?: Date
  ): Promise<RevenueAnalytics> {
    try {
      const bookings = await bookingEngine.getAllBookings()
      const db = blink.db as any
      const [roomTypes, properties, allChargesRaw, allStandaloneSales] = await Promise.all([
        db.roomTypes.list(),
        db.properties.list(),
        (db.bookingCharges.list({ limit: 5000 }) as Promise<any[]>).catch(() => [] as any[]),
        standaloneSalesService.getAllSales().catch(() => [] as any[]),
      ])

      // Group booking charges by booking ID for O(1) lookup
      const chargesByBookingId = new Map<string, any[]>()
      for (const c of (allChargesRaw || [])) {
        const key = c.bookingId || c.booking_id || ''
        if (!key) continue
        if (!chargesByBookingId.has(key)) chargesByBookingId.set(key, [])
        chargesByBookingId.get(key)!.push(c)
      }

      // Filter by date range if provided
      const filteredBookings = startDate && endDate
        ? bookings.filter(b => {
          const checkIn = new Date(b.dates.checkIn)
          return checkIn >= startDate && checkIn <= endDate
        })
        : bookings

      // Calculate total revenue from checked-in/checked-out bookings only
      const revenueBookings = filteredBookings.filter(
        b => ['checked-in', 'checked-out'].includes(b.status)
      )

      // Debug logging
      console.log('[AnalyticsService] Total bookings:', bookings.length)
      console.log('[AnalyticsService] Revenue bookings (confirmed/checked-in/out):', revenueBookings.length)
      if (revenueBookings.length > 0) {
        console.log('[AnalyticsService] Sample booking:', {
          status: revenueBookings[0].status,
          amount: revenueBookings[0].amount,
          source: revenueBookings[0].source,
          payment: revenueBookings[0].payment
        })
      }

      const roomRevenueTotal = revenueBookings.reduce(
        (sum, b) => sum + Number(b.amount || 0),
        0
      )

      // Additional revenue from booking charges — iterate all raw charges directly to avoid
      // booking-ID mismatch between bookingEngine IDs and remoteId used in GuestChargesDialog
      const additionalRevenueByCategory: Record<string, number> = {}
      let additionalChargesTotal = 0
      for (const c of (allChargesRaw || [])) {
        const amt = Number(c.amount || 0)
        additionalChargesTotal += amt
        const cat = c.category || 'other'
        additionalRevenueByCategory[cat] = (additionalRevenueByCategory[cat] || 0) + amt
      }

      // Standalone sales (all-time — filtered by date range below for period breakdowns)
      const standaloneSalesTotal = (allStandaloneSales || []).reduce(
        (sum: number, s: any) => sum + Number(s.amount || 0), 0
      )
      for (const s of (allStandaloneSales || [])) {
        const cat = s.category || 'other'
        additionalRevenueByCategory[cat] = (additionalRevenueByCategory[cat] || 0) + Number(s.amount || 0)
      }

      const totalRevenue = roomRevenueTotal + additionalChargesTotal + standaloneSalesTotal

      // Revenue by period
      const today = new Date().toISOString().split('T')[0]
      const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
      const thisMonthStart = new Date()
      thisMonthStart.setDate(1)
      const lastMonthStart = new Date()
      lastMonthStart.setMonth(lastMonthStart.getMonth() - 1, 1)
      const lastMonthEnd = new Date()
      lastMonthEnd.setDate(0)
      const thisYearStart = new Date()
      thisYearStart.setMonth(0, 1)
      const lastYearStart = new Date()
      lastYearStart.setFullYear(lastYearStart.getFullYear() - 1, 0, 1)
      const lastYearEnd = new Date()
      lastYearEnd.setFullYear(lastYearEnd.getFullYear() - 1, 11, 31)

      // Helper: room revenue only for a set of bookings (no charges — charges counted separately below)
      const bookingRoomRev = (bks: any[]) =>
        bks.reduce((sum, b) => sum + Number(b.amount || 0), 0)

      // Helper: standalone sales revenue within a date range
      const salesInRange = (from: string, to?: string) =>
        (allStandaloneSales || []).reduce((sum: number, s: any) => {
          const sd = s.saleDate || s.sale_date || ''
          if (sd < from) return sum
          if (to && sd > to) return sum
          return sum + Number(s.amount || 0)
        }, 0)

      // Helper: booking charges created within a date range (filter by createdAt)
      // Uses date-only slicing (YYYY-MM-DD) for correct comparison against timestamps,
      // matching the same logic as the "Additional Revenue Sources" card.
      const chargesInRange = (from: string, to?: string) =>
        (allChargesRaw || []).reduce((sum: number, c: any) => {
          const cd = c.createdAt || c.created_at || ''
          if (!cd) return sum
          const cdDate = cd.slice(0, 10) // YYYY-MM-DD only
          if (cdDate < from) return sum
          if (to && cdDate > to) return sum
          return sum + Number(c.amount || 0)
        }, 0)

      const thisWeekEnd  = endOfWeek(new Date(), { weekStartsOn: 1 })
      const thisMonthEnd = endOfMonth(new Date())
      const thisYearEnd  = endOfYear(new Date())

      const todayStr          = today
      const weekStartStr      = thisWeekStart.toISOString().split('T')[0]
      const weekEndStr        = thisWeekEnd.toISOString().split('T')[0]
      const monthStartStr     = thisMonthStart.toISOString().split('T')[0]
      const monthEndStr       = thisMonthEnd.toISOString().split('T')[0]
      const lastMonthStartStr = lastMonthStart.toISOString().split('T')[0]
      const lastMonthEndStr   = lastMonthEnd.toISOString().split('T')[0]
      const yearStartStr      = thisYearStart.toISOString().split('T')[0]
      const yearEndStr        = thisYearEnd.toISOString().split('T')[0]
      const lastYearStartStr  = lastYearStart.toISOString().split('T')[0]
      const lastYearEndStr    = lastYearEnd.toISOString().split('T')[0]

      const revenueByPeriod = {
        today: bookingRoomRev(revenueBookings.filter(b => b.dates.checkIn === todayStr))
          + chargesInRange(todayStr, todayStr)
          + salesInRange(todayStr, todayStr),

        thisWeek: bookingRoomRev(revenueBookings.filter(b => {
            const ci = new Date(b.dates.checkIn)
            return ci >= thisWeekStart && ci <= thisWeekEnd
          }))
          + chargesInRange(weekStartStr, weekEndStr)
          + salesInRange(weekStartStr, weekEndStr),

        thisMonth: bookingRoomRev(revenueBookings.filter(b => {
            const ci = new Date(b.dates.checkIn)
            return ci >= thisMonthStart && ci <= thisMonthEnd
          }))
          + chargesInRange(monthStartStr, monthEndStr)
          + salesInRange(monthStartStr, monthEndStr),

        lastMonth: bookingRoomRev(revenueBookings.filter(b => {
            const checkIn = new Date(b.dates.checkIn)
            return checkIn >= lastMonthStart && checkIn <= lastMonthEnd
          }))
          + chargesInRange(lastMonthStartStr, lastMonthEndStr)
          + salesInRange(lastMonthStartStr, lastMonthEndStr),

        thisYear: bookingRoomRev(revenueBookings.filter(b => {
            const ci = new Date(b.dates.checkIn)
            return ci >= thisYearStart && ci <= thisYearEnd
          }))
          + chargesInRange(yearStartStr, yearEndStr)
          + salesInRange(yearStartStr, yearEndStr),

        lastYear: bookingRoomRev(revenueBookings.filter(b => {
            const checkIn = new Date(b.dates.checkIn)
            return checkIn >= lastYearStart && checkIn <= lastYearEnd
          }))
          + chargesInRange(lastYearStartStr, lastYearEndStr)
          + salesInRange(lastYearStartStr, lastYearEndStr),
      }

      // Revenue by room type
      const roomTypeMap = new Map<string, string>()
      roomTypes.forEach((rt: any) => {
        roomTypeMap.set(rt.id, rt.name)
      })

      // Build property -> roomType mapping
      const propertyTypeByRoomNumber = new Map<string, string>()
      properties.forEach((p: any) => {
        if (p.roomNumber && p.propertyTypeId) {
          propertyTypeByRoomNumber.set(p.roomNumber, p.propertyTypeId)
        }
      })

      const revenueByType = new Map<string, { revenue: number; count: number }>()
      revenueBookings.forEach(b => {
        // Try to resolve room type ID
        let typeId = b.roomType
        const typeIdFromProperty = propertyTypeByRoomNumber.get(b.roomNumber)
        if (typeIdFromProperty) {
          typeId = typeIdFromProperty
        }

        const current = revenueByType.get(typeId) || { revenue: 0, count: 0 }
        revenueByType.set(typeId, {
          revenue: current.revenue + Number(b.amount || 0),
          count: current.count + 1
        })
      })

      const revenueByRoomType = Array.from(revenueByType.entries()).map(
        ([typeId, data]) => ({
          roomTypeId: typeId,
          roomTypeName: roomTypeMap.get(typeId) || typeId,
          revenue: data.revenue,
          bookingCount: data.count,
          percentage: roomRevenueTotal > 0 ? (data.revenue / roomRevenueTotal) * 100 : 0
        })
      ).sort((a, b) => b.revenue - a.revenue)

      // Revenue by payment method — split-aware helpers
      const normalizePayMethod = (raw: string): string => {
        const s = (raw || '').trim().toLowerCase()
        if (s === 'cash') return 'cash'
        if (s === 'mobile_money' || s === 'mobile money' || s.includes('mobile') || s.includes('momo')) return 'mobile_money'
        if (s === 'card' || s.includes('card') || s.includes('credit') || s.includes('debit')) return 'card'
        return 'not_paid'
      }

      // Returns all (method, amount) pairs for a booking, handling splits
      const getPaySplits = (b: any): Array<{ method: string; amount: number }> => {
        if (b.paymentSplits && b.paymentSplits.length > 0) {
          return b.paymentSplits
            .map((s: any) => ({ method: normalizePayMethod(s.method), amount: Number(s.amount) || 0 }))
            .filter((s: any) => s.method && s.method !== 'not_paid')
        }
        const m = normalizePayMethod(b.paymentMethod || b.payment?.method || (b as any).payment_method || '')
        return m && m !== 'not_paid' ? [{ method: m, amount: Number(b.amount || 0) }] : []
      }

      let _cash = 0, _cashCount = 0, _mobileMoney = 0, _momoCount = 0, _card = 0, _cardCount = 0
      let _notPaid = 0, _notPaidCount = 0
      for (const b of revenueBookings) {
        const splts = getPaySplits(b)
        const bCharges = chargesByBookingId.get(b.id) || []
        // Room price — distribute by splits or mark not_paid
        if (splts.length === 0) { _notPaid += Number(b.amount || 0); _notPaidCount++ }
        else {
          for (const s of splts) {
            if      (s.method === 'cash')         { _cash += s.amount; _cashCount++ }
            else if (s.method === 'mobile_money') { _mobileMoney += s.amount; _momoCount++ }
            else if (s.method === 'card')         { _card += s.amount; _cardCount++ }
          }
        }
        // Each charge uses its own payment method if set; otherwise fall back proportional to booking splits
        const splitsSum = splts.reduce((s: number, p: any) => s + p.amount, 0)
        for (const c of bCharges) {
          const amt = Number(c.amount || 0)
          const cPm = decodeChargePaymentMethod(c.notes).toLowerCase()
          if (cPm === 'cash' || cPm === 'mobile_money' || cPm === 'card') {
            if      (cPm === 'cash')         { _cash += amt; _cashCount++ }
            else if (cPm === 'mobile_money') { _mobileMoney += amt; _momoCount++ }
            else if (cPm === 'card')         { _card += amt; _cardCount++ }
          } else if (splts.length > 0) {
            // Fall back: distribute proportionally across booking splits
            for (const s of splts) {
              const proportion = splitsSum > 0 ? s.amount / splitsSum : 1 / splts.length
              const portionAmt = amt * proportion
              if      (s.method === 'cash')         { _cash += portionAmt; _cashCount++ }
              else if (s.method === 'mobile_money') { _mobileMoney += portionAmt; _momoCount++ }
              else if (s.method === 'card')         { _card += portionAmt; _cardCount++ }
            }
          } else {
            _notPaid += amt
          }
        }
      }
      // Standalone sales — add to the payment method buckets
      for (const s of (allStandaloneSales || [])) {
        const amt = Number((s as any).amount || 0)
        const pm = ((s as any).paymentMethod || (s as any).payment_method || '').toLowerCase()
        if      (pm === 'cash')         { _cash += amt; _cashCount++ }
        else if (pm === 'mobile_money') { _mobileMoney += amt; _momoCount++ }
        else if (pm === 'card')         { _card += amt; _cardCount++ }
      }

      const revenueByPaymentMethod = {
        cash: _cash,         mobileMoney: _mobileMoney,  card: _card,         notPaid: _notPaid,
        cashCount: _cashCount, mobileMonetyCount: _momoCount, cardCount: _cardCount, notPaidCount: _notPaidCount,
      }

      // Per-period payment method breakdown helper (split-aware, includes charges)
      const payBreakdown = (bks: any[], salesFrom?: string, salesTo?: string) => {
        let c = 0, cN = 0, m = 0, mN = 0, k = 0, kN = 0
        for (const b of bks) {
          const splts = getPaySplits(b)
          const bCharges = chargesByBookingId.get(b.id) || []
          if (splts.length === 0) continue
          const splitsSum = splts.reduce((s: number, p: any) => s + p.amount, 0)
          // Room price splits
          for (const s of splts) {
            if      (s.method === 'cash')         { c += s.amount; cN++ }
            else if (s.method === 'mobile_money') { m += s.amount; mN++ }
            else if (s.method === 'card')         { k += s.amount; kN++ }
          }
          // Charges — use own payment method if set, else proportional fallback
          for (const cc of bCharges) {
            const amt = Number(cc.amount || 0)
            const cPm = decodeChargePaymentMethod(cc.notes).toLowerCase()
            if (cPm === 'cash' || cPm === 'mobile_money' || cPm === 'card') {
              if      (cPm === 'cash')         { c += amt; cN++ }
              else if (cPm === 'mobile_money') { m += amt; mN++ }
              else if (cPm === 'card')         { k += amt; kN++ }
            } else {
              for (const s of splts) {
                const proportion = splitsSum > 0 ? s.amount / splitsSum : 1 / splts.length
                const portionAmt = amt * proportion
                if      (s.method === 'cash')         { c += portionAmt; cN++ }
                else if (s.method === 'mobile_money') { m += portionAmt; mN++ }
                else if (s.method === 'card')         { k += portionAmt; kN++ }
              }
            }
          }
        }
        // Add standalone sales in the period
        for (const s of (allStandaloneSales || [])) {
          const sd = (s as any).saleDate || (s as any).sale_date || ''
          if (salesFrom && sd < salesFrom) continue
          if (salesTo && sd > salesTo) continue
          const amt = Number((s as any).amount || 0)
          const pm = ((s as any).paymentMethod || '').toLowerCase()
          if      (pm === 'cash')         { c += amt; cN++ }
          else if (pm === 'mobile_money') { m += amt; mN++ }
          else if (pm === 'card')         { k += amt; kN++ }
        }
        return { cash: c, cashCount: cN, mobileMoney: m, mobileMonetyCount: mN, card: k, cardCount: kN }
      }
      const weekBks  = revenueBookings.filter(b => new Date(b.dates.checkIn) >= thisWeekStart)
      const monthBks = revenueBookings.filter(b => new Date(b.dates.checkIn) >= thisMonthStart)
      const yearBks  = revenueBookings.filter(b => new Date(b.dates.checkIn) >= thisYearStart)
      const revenueByPaymentMethodByPeriod = {
        thisWeek:  payBreakdown(weekBks,  thisWeekStart.toISOString().split('T')[0]),
        thisMonth: payBreakdown(monthBks, thisMonthStart.toISOString().split('T')[0]),
        thisYear:  payBreakdown(yearBks,  thisYearStart.toISOString().split('T')[0]),
      }

      // Revenue by source
      const revenueBySource = {
        online: revenueBookings
          .filter(b => b.source === 'online')
          .reduce((sum, b) => sum + Number(b.amount || 0), 0),

        reception: revenueBookings
          .filter(b => b.source === 'reception')
          .reduce((sum, b) => sum + Number(b.amount || 0), 0)
      }

      // Calculate ADR and RevPAR
      const totalRooms = new Set(
        properties.map((p: any) => String(p.roomNumber || '').trim()).filter(Boolean)
      ).size

      const totalNights = revenueBookings.reduce((sum, b) => {
        const checkIn = new Date(b.dates.checkIn)
        const checkOut = new Date(b.dates.checkOut)
        const nights = Math.max(
          1,
          Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))
        )
        return sum + nights
      }, 0)

      const averageDailyRate = totalNights > 0 ? totalRevenue / totalNights : 0
      const revenuePerAvailableRoom = totalRooms > 0 ? totalRevenue / totalRooms : 0

      // Daily revenue history (last 30 days)
      const dailyRevenueHistory = []
      for (let i = 29; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]

        const dayBookings = revenueBookings.filter(b => b.dates.checkIn === dateStr)
        const dayRevenue = dayBookings.reduce((sum, b) => sum + Number(b.amount || 0), 0)
          + chargesInRange(dateStr, dateStr)
        const daySales = (allStandaloneSales || []).reduce((sum: number, s: any) => {
          const sd = s.saleDate || s.sale_date || ''
          return sd === dateStr ? sum + Number(s.amount || 0) : sum
        }, 0)

        dailyRevenueHistory.push({
          date: dateStr,
          revenue: dayRevenue + daySales,
          bookingCount: dayBookings.length
        })
      }

      return {
        totalRevenue,
        roomRevenueTotal,
        standaloneSalesTotal,
        additionalRevenueByCategory,
        revenueByPeriod,
        revenueByRoomType,
        revenueByPaymentMethod,
        revenueByPaymentMethodByPeriod,
        revenueBySource,
        averageDailyRate,
        revenuePerAvailableRoom,
        dailyRevenueHistory
      }
    } catch (error) {
      console.error('Failed to calculate revenue analytics:', error)
      throw error
    }
  }

  /**
   * Calculate occupancy analytics
   */
  async getOccupancyAnalytics(): Promise<OccupancyAnalytics> {
    try {
      const bookings = await bookingEngine.getAllBookings()
      const db = blink.db as any
      const [properties, roomTypes] = await Promise.all([
        db.properties.list(),
        db.roomTypes.list()
      ])

      const totalRooms = new Set(
        properties.map((p: any) => String(p.roomNumber || '').trim()).filter(Boolean)
      ).size

      const today = new Date().toISOString().split('T')[0]

      // Current occupancy
      const currentOccupied = bookings.filter(b => {
        const checkIn = b.dates.checkIn
        const checkOut = b.dates.checkOut
        const isActive = ['confirmed', 'checked-in', 'reserved'].includes(b.status)
        return isActive && checkIn <= today && checkOut > today
      }).length

      const currentOccupancyRate = totalRooms > 0
        ? (currentOccupied / totalRooms) * 100
        : 0

      // Occupancy by room type
      const roomTypeOccupancy = new Map<string, { occupied: number; total: number }>()

      // Count total rooms by type
      properties.forEach((p: any) => {
        const typeId = p.propertyTypeId
        if (typeId) {
          const current = roomTypeOccupancy.get(typeId) || { occupied: 0, total: 0 }
          roomTypeOccupancy.set(typeId, { ...current, total: current.total + 1 })
        }
      })

      // Count occupied rooms by type
      const currentBookings = bookings.filter(b => {
        const checkIn = b.dates.checkIn
        const checkOut = b.dates.checkOut
        const isActive = ['confirmed', 'checked-in', 'reserved'].includes(b.status)
        return isActive && checkIn <= today && checkOut > today
      })

      const propertyTypeByRoomNumber = new Map<string, string>()
      properties.forEach((p: any) => {
        if (p.roomNumber && p.propertyTypeId) {
          propertyTypeByRoomNumber.set(p.roomNumber, p.propertyTypeId)
        }
      })

      currentBookings.forEach(b => {
        const typeId = propertyTypeByRoomNumber.get(b.roomNumber)
        if (typeId) {
          const current = roomTypeOccupancy.get(typeId) || { occupied: 0, total: 0 }
          roomTypeOccupancy.set(typeId, { ...current, occupied: current.occupied + 1 })
        }
      })

      const roomTypeMap = new Map<string, string>()
      roomTypes.forEach((rt: any) => {
        roomTypeMap.set(rt.id, rt.name)
      })

      const occupancyByRoomType = Array.from(roomTypeOccupancy.entries()).map(
        ([typeId, data]) => ({
          roomTypeId: typeId,
          roomTypeName: roomTypeMap.get(typeId) || typeId,
          occupancyRate: data.total > 0 ? (data.occupied / data.total) * 100 : 0,
          occupiedRooms: data.occupied,
          totalRooms: data.total
        })
      )

      // Occupancy trend (last 30 days)
      const occupancyTrend = []
      for (let i = 29; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]

        const occupied = bookings.filter(b => {
          const checkIn = b.dates.checkIn
          const checkOut = b.dates.checkOut
          const isActive = ['confirmed', 'checked-in', 'checked-out'].includes(b.status)
          return isActive && checkIn <= dateStr && checkOut > dateStr
        }).length

        const rate = totalRooms > 0 ? (occupied / totalRooms) * 100 : 0

        occupancyTrend.push({
          date: dateStr,
          rate: Math.round(rate * 10) / 10,
          occupiedRooms: occupied
        })
      }

      // Average length of stay
      const completedBookings = bookings.filter(
        b => b.status === 'checked-out' || b.status === 'confirmed'
      )

      const totalStayDays = completedBookings.reduce((sum, b) => {
        const checkIn = new Date(b.dates.checkIn)
        const checkOut = new Date(b.dates.checkOut)
        const days = Math.max(
          1,
          Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))
        )
        return sum + days
      }, 0)

      const averageLengthOfStay = completedBookings.length > 0
        ? totalStayDays / completedBookings.length
        : 0

      // Booking lead time (days between booking created and check-in)
      const bookingsWithLeadTime = bookings.filter(b => b.createdAt && b.dates.checkIn)
      const totalLeadTime = bookingsWithLeadTime.reduce((sum, b) => {
        const created = new Date(b.createdAt)
        const checkIn = new Date(b.dates.checkIn)
        const days = Math.max(0, Math.ceil((checkIn.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)))
        return sum + days
      }, 0)

      const bookingLeadTime = bookingsWithLeadTime.length > 0
        ? totalLeadTime / bookingsWithLeadTime.length
        : 0

      // Forecast (simple: based on existing future bookings)
      const futureBookings = bookings.filter(b => {
        const checkIn = new Date(b.dates.checkIn)
        const isActive = ['confirmed', 'reserved'].includes(b.status)
        return isActive && checkIn > new Date()
      })

      const next7Days = new Date()
      next7Days.setDate(next7Days.getDate() + 7)
      const next30Days = new Date()
      next30Days.setDate(next30Days.getDate() + 30)
      const next90Days = new Date()
      next90Days.setDate(next90Days.getDate() + 90)

      const forecast = {
        next7Days: Math.round((futureBookings.filter(b => {
          const checkIn = new Date(b.dates.checkIn)
          return checkIn <= next7Days
        }).length / totalRooms) * 100),

        next30Days: Math.round((futureBookings.filter(b => {
          const checkIn = new Date(b.dates.checkIn)
          return checkIn <= next30Days
        }).length / totalRooms) * 100),

        next90Days: Math.round((futureBookings.filter(b => {
          const checkIn = new Date(b.dates.checkIn)
          return checkIn <= next90Days
        }).length / totalRooms) * 100)
      }

      return {
        currentOccupancyRate: Math.round(currentOccupancyRate),
        occupiedRooms: currentOccupied,
        availableRooms: totalRooms - currentOccupied,
        totalRooms,
        occupancyByRoomType,
        averageLengthOfStay: Math.round(averageLengthOfStay * 10) / 10,
        occupancyTrend,
        bookingLeadTime: Math.round(bookingLeadTime * 10) / 10,
        forecast
      }
    } catch (error) {
      console.error('Failed to calculate occupancy analytics:', error)
      throw error
    }
  }

  /**
   * Calculate guest analytics
   */
  async getGuestAnalytics(): Promise<GuestAnalytics> {
    try {
      const db = blink.db as any
      const guests = await db.guests.list()
      const bookings = await bookingEngine.getAllBookings()

      const totalGuests = guests.length

      // New guests this month and year
      const thisMonthStart = new Date()
      thisMonthStart.setDate(1)
      const thisYearStart = new Date()
      thisYearStart.setMonth(0, 1)

      const newGuestsThisMonth = guests.filter(
        (g: any) => new Date(g.createdAt) >= thisMonthStart
      ).length

      const newGuestsThisYear = guests.filter(
        (g: any) => new Date(g.createdAt) >= thisYearStart
      ).length

      // Repeat guest rate
      const guestBookingCount = new Map<string, number>()
      bookings.forEach(b => {
        const guestEmail = b.guest.email.toLowerCase().trim()
        guestBookingCount.set(
          guestEmail,
          (guestBookingCount.get(guestEmail) || 0) + 1
        )
      })

      const repeatGuests = Array.from(guestBookingCount.values()).filter(
        count => count > 1
      ).length

      const vipGuests = Array.from(guestBookingCount.values()).filter(
        count => count >= 5
      ).length

      const repeatGuestRate = totalGuests > 0
        ? (repeatGuests / totalGuests) * 100
        : 0

      const guestSegmentation = {
        new: totalGuests - repeatGuests,
        returning: repeatGuests,
        vip: vipGuests
      }

      // Top guests by revenue
      const guestRevenueMap = new Map<string, {
        id: string
        name: string
        email: string
        totalRevenue: number
        bookingCount: number
        lastVisit: string
        totalNights: number
      }>()

      bookings
        .filter(b => ['checked-in', 'checked-out'].includes(b.status))
        .forEach(b => {
          const email = b.guest.email.toLowerCase().trim()
          const existing = guestRevenueMap.get(email)

          const checkIn = new Date(b.dates.checkIn)
          const checkOut = new Date(b.dates.checkOut)
          const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)))

          if (existing) {
            existing.totalRevenue += Number(b.amount || 0)
            existing.bookingCount += 1
            existing.totalNights += nights
            if (b.dates.checkIn > existing.lastVisit) {
              existing.lastVisit = b.dates.checkIn
            }
          } else {
            guestRevenueMap.set(email, {
              id: email,
              name: b.guest.fullName,
              email: b.guest.email,
              totalRevenue: Number(b.amount || 0),
              bookingCount: 1,
              lastVisit: b.dates.checkIn,
              totalNights: nights
            })
          }
        })

      const topGuests = Array.from(guestRevenueMap.values())
        .map(guest => ({
          ...guest,
          averageStay: guest.bookingCount > 0 ? guest.totalNights / guest.bookingCount : 0
        }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, 10)

      // Guest lifetime value calculations
      const allGuestRevenues = Array.from(guestRevenueMap.values())
        .map(g => g.totalRevenue)
        .sort((a, b) => b - a)

      const average = allGuestRevenues.length > 0
        ? allGuestRevenues.reduce((sum, val) => sum + val, 0) / allGuestRevenues.length
        : 0

      const median = allGuestRevenues.length > 0
        ? allGuestRevenues[Math.floor(allGuestRevenues.length / 2)]
        : 0

      const top10PercentCount = Math.ceil(allGuestRevenues.length * 0.1)
      const top10Percent = top10PercentCount > 0
        ? allGuestRevenues.slice(0, top10PercentCount).reduce((sum, val) => sum + val, 0) / top10PercentCount
        : 0

      // Booking patterns
      const bookingWindows = bookings
        .filter(b => b.createdAt && b.dates.checkIn)
        .map(b => {
          const created = new Date(b.createdAt)
          const checkIn = new Date(b.dates.checkIn)
          return Math.max(0, Math.ceil((checkIn.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)))
        })

      const averageBookingWindow = bookingWindows.length > 0
        ? bookingWindows.reduce((sum, val) => sum + val, 0) / bookingWindows.length
        : 0

      const stayDurations = bookings.map(b => {
        const checkIn = new Date(b.dates.checkIn)
        const checkOut = new Date(b.dates.checkOut)
        return Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)))
      })

      const averageStayDuration = stayDurations.length > 0
        ? stayDurations.reduce((sum, val) => sum + val, 0) / stayDurations.length
        : 0

      // Peak booking days (day of week analysis)
      const dayOfWeekCounts = new Map<string, number>()
      const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

      bookings.forEach(b => {
        if (b.createdAt) {
          const created = new Date(b.createdAt)
          const dayName = daysOfWeek[created.getDay()]
          dayOfWeekCounts.set(dayName, (dayOfWeekCounts.get(dayName) || 0) + 1)
        }
      })

      const peakBookingDays = Array.from(dayOfWeekCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([day]) => day)

      return {
        totalGuests,
        newGuestsThisMonth,
        newGuestsThisYear,
        repeatGuestRate: Math.round(repeatGuestRate),
        guestSegmentation,
        topGuests,
        guestLifetimeValue: {
          average: Math.round(average * 100) / 100,
          median: Math.round(median * 100) / 100,
          top10Percent: Math.round(top10Percent * 100) / 100
        },
        bookingPatterns: {
          averageBookingWindow: Math.round(averageBookingWindow * 10) / 10,
          averageStayDuration: Math.round(averageStayDuration * 10) / 10,
          peakBookingDays
        }
      }
    } catch (error) {
      console.error('Failed to calculate guest analytics:', error)
      throw error
    }
  }

  /**
   * Calculate performance metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    try {
      const [revenueAnalytics, occupancyAnalytics] = await Promise.all([
        this.getRevenueAnalytics(),
        this.getOccupancyAnalytics()
      ])

      const bookings = await bookingEngine.getAllBookings()

      const totalBookings = bookings.filter(
        b => ['checked-in', 'checked-out'].includes(b.status)
      ).length

      const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length
      const cancellationRate = (totalBookings + cancelledBookings) > 0
        ? (cancelledBookings / (totalBookings + cancelledBookings)) * 100
        : 0

      // RevPOR (Revenue per Occupied Room)
      const revPOR = occupancyAnalytics.occupiedRooms > 0
        ? revenueAnalytics.totalRevenue / occupancyAnalytics.occupiedRooms
        : 0

      // Room status distribution (placeholder - implement when housekeeping data available)
      const db = blink.db as any
      const rooms = await db.rooms.list()

      const roomStatusDistribution = {
        available: rooms.filter((r: any) => r.status === 'available').length,
        occupied: occupancyAnalytics.occupiedRooms,
        maintenance: rooms.filter((r: any) => r.status === 'maintenance').length,
        cleaning: rooms.filter((r: any) => r.status === 'cleaning').length
      }

      return {
        adr: revenueAnalytics.averageDailyRate,
        revPAR: revenueAnalytics.revenuePerAvailableRoom,
        revPOR,
        occupancyRate: occupancyAnalytics.currentOccupancyRate,
        totalBookings,
        conversionMetrics: {
          bookingConversionRate: 100, // Placeholder - track this when booking attempts are tracked
          cancellationRate: Math.round(cancellationRate * 10) / 10,
          noShowRate: 0 // Placeholder - track no-shows when implemented
        },
        operationalMetrics: {
          averageCheckInTime: '14:00', // Placeholder - calculate from actual check-in times
          averageCheckOutTime: '11:00', // Placeholder - calculate from actual check-out times
          roomStatusDistribution
        }
      }
    } catch (error) {
      console.error('Failed to calculate performance metrics:', error)
      throw error
    }
  }

  /**
   * Calculate financial analytics
   */
  async getFinancialAnalytics(): Promise<FinancialAnalytics> {
    try {
      const db = blink.db as any
      const [invoices, revenueAnalytics] = await Promise.all([
        db.invoices.list(),
        this.getRevenueAnalytics()
      ])

      // Revenue breakdown
      const totalRoomRevenue = revenueAnalytics.totalRevenue
      const totalTaxes = invoices.reduce(
        (sum: number, inv: any) => sum + (Number(inv.taxAmount) || 0),
        0
      )

      const revenueBreakdown = {
        roomRevenue: totalRoomRevenue,
        taxes: totalTaxes,
        fees: 0 // Placeholder for additional fees
      }

      // Invoice metrics
      const paidInvoices = invoices.filter((inv: any) => inv.status === 'paid')
      const unpaidInvoices = invoices.filter((inv: any) => inv.status === 'unpaid')

      const today = new Date()
      const overdueInvoices = unpaidInvoices.filter((inv: any) => {
        const dueDate = new Date(inv.dueDate)
        return dueDate < today
      })

      const totalInvoiced = invoices.reduce(
        (sum: number, inv: any) => sum + (Number(inv.total) || 0),
        0
      )

      const totalCollected = paidInvoices.reduce(
        (sum: number, inv: any) => sum + (Number(inv.total) || 0),
        0
      )

      const invoiceMetrics = {
        totalInvoices: invoices.length,
        paidInvoices: paidInvoices.length,
        unpaidInvoices: unpaidInvoices.length,
        overdueInvoices: overdueInvoices.length,
        totalInvoiced,
        totalCollected
      }

      // Outstanding payments
      const outstandingTotal = totalInvoiced - totalCollected

      // Age outstanding payments
      const outstandingByAge = unpaidInvoices.reduce((acc: any, inv: any) => {
        const dueDate = new Date(inv.dueDate)
        const daysOverdue = Math.ceil((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
        const amount = Number(inv.total) || 0

        if (daysOverdue <= 30) {
          acc.current += amount
        } else if (daysOverdue <= 60) {
          acc.late30 += amount
        } else if (daysOverdue <= 90) {
          acc.late60 += amount
        } else {
          acc.late90Plus += amount
        }

        return acc
      }, { current: 0, late30: 0, late60: 0, late90Plus: 0 })

      const outstandingPayments = {
        total: outstandingTotal,
        byAge: outstandingByAge
      }

      // Payment collection metrics
      const collectionRate = totalInvoiced > 0
        ? (totalCollected / totalInvoiced) * 100
        : 0

      // Calculate average days to payment
      const paidInvoicesWithDates = paidInvoices.filter(
        (inv: any) => inv.invoiceDate && inv.sentAt
      )
      const totalDaysToPayment = paidInvoicesWithDates.reduce((sum: number, inv: any) => {
        const invoiceDate = new Date(inv.invoiceDate)
        const paidDate = new Date(inv.sentAt)
        const days = Math.ceil((paidDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24))
        return sum + Math.max(0, days)
      }, 0)

      const averageDaysToPayment = paidInvoicesWithDates.length > 0
        ? totalDaysToPayment / paidInvoicesWithDates.length
        : 0

      const paymentCollection = {
        collectionRate: Math.round(collectionRate * 10) / 10,
        averageDaysToPayment: Math.round(averageDaysToPayment)
      }

      // Tax analytics by period
      const taxByPeriod = []
      for (let i = 11; i >= 0; i--) {
        const date = new Date()
        date.setMonth(date.getMonth() - i)
        const monthStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })

        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)

        const monthTax = invoices
          .filter((inv: any) => {
            const invDate = new Date(inv.invoiceDate)
            return invDate >= monthStart && invDate <= monthEnd
          })
          .reduce((sum: number, inv: any) => sum + (Number(inv.taxAmount) || 0), 0)

        taxByPeriod.push({
          period: monthStr,
          amount: monthTax
        })
      }

      const taxAnalytics = {
        totalTaxCollected: totalTaxes,
        taxByPeriod
      }

      return {
        revenueBreakdown,
        outstandingPayments,
        paymentCollection,
        invoiceMetrics,
        taxAnalytics
      }
    } catch (error) {
      console.error('Failed to calculate financial analytics:', error)
      throw error
    }
  }
}

export const analyticsService = new AnalyticsService()






