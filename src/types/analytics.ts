export interface PayMethodBreakdown {
  cash: number; cashCount: number
  mobileMoney: number; mobileMonetyCount: number
  card: number; cardCount: number
}

export interface RevenueAnalytics {
  totalRevenue: number
  revenueByPeriod: {
    today: number
    thisWeek: number
    thisMonth: number
    thisYear: number
    lastMonth: number
    lastYear: number
  }
  revenueByRoomType: Array<{
    roomTypeId: string
    roomTypeName: string
    revenue: number
    bookingCount: number
    percentage: number
  }>
  revenueByPaymentMethod: {
    cash: number
    mobileMoney: number
    card: number
    notPaid: number
    cashCount: number
    mobileMonetyCount: number
    cardCount: number
    notPaidCount: number
  }
  revenueByPaymentMethodByPeriod: {
    thisWeek: PayMethodBreakdown
    thisMonth: PayMethodBreakdown
    thisYear: PayMethodBreakdown
  }
  revenueBySource: {
    online: number
    reception: number
  }
  averageDailyRate: number
  revenuePerAvailableRoom: number
  dailyRevenueHistory: Array<{
    date: string
    revenue: number
    bookingCount: number
  }>
  additionalRevenueByCategory?: Record<string, number>
  standaloneSalesTotal?: number
  roomRevenueTotal?: number
}

export interface OccupancyAnalytics {
  currentOccupancyRate: number
  occupiedRooms: number
  availableRooms: number
  totalRooms: number
  occupancyByRoomType: Array<{
    roomTypeId: string
    roomTypeName: string
    occupancyRate: number
    occupiedRooms: number
    totalRooms: number
  }>
  averageLengthOfStay: number
  occupancyTrend: Array<{
    date: string
    rate: number
    occupiedRooms: number
  }>
  bookingLeadTime: number
  forecast: {
    next7Days: number
    next30Days: number
    next90Days: number
  }
}

export interface GuestAnalytics {
  totalGuests: number
  newGuestsThisMonth: number
  newGuestsThisYear: number
  repeatGuestRate: number
  guestSegmentation: {
    new: number
    returning: number
    vip: number
  }
  topGuests: Array<{
    id: string
    name: string
    email: string
    totalRevenue: number
    bookingCount: number
    lastVisit: string
    averageStay: number
  }>
  guestLifetimeValue: {
    average: number
    median: number
    top10Percent: number
  }
  bookingPatterns: {
    averageBookingWindow: number
    averageStayDuration: number
    peakBookingDays: string[]
  }
}

export interface PerformanceMetrics {
  adr: number // Average Daily Rate
  revPAR: number // Revenue per Available Room
  revPOR: number // Revenue per Occupied Room
  occupancyRate: number
  totalBookings: number
  conversionMetrics: {
    bookingConversionRate: number
    cancellationRate: number
    noShowRate: number
  }
  operationalMetrics: {
    averageCheckInTime: string
    averageCheckOutTime: string
    roomStatusDistribution: {
      available: number
      occupied: number
      maintenance: number
      cleaning: number
    }
  }
}

export interface FinancialAnalytics {
  revenueBreakdown: {
    roomRevenue: number
    taxes: number
    fees: number
  }
  outstandingPayments: {
    total: number
    byAge: {
      current: number
      late30: number
      late60: number
      late90Plus: number
    }
  }
  paymentCollection: {
    collectionRate: number
    averageDaysToPayment: number
  }
  invoiceMetrics: {
    totalInvoices: number
    paidInvoices: number
    unpaidInvoices: number
    overdueInvoices: number
    totalInvoiced: number
    totalCollected: number
  }
  taxAnalytics: {
    totalTaxCollected: number
    taxByPeriod: Array<{
      period: string
      amount: number
    }>
  }
}

export interface DateRange {
  startDate: Date
  endDate: Date
}

export interface AnalyticsFilter {
  dateRange?: DateRange
  roomTypeIds?: string[]
  paymentMethods?: string[]
  sources?: string[]
  status?: string[]
}






