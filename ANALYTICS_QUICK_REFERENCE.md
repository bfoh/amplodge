# 📊 Analytics System - Quick Reference Card

**Print this page or keep it handy during development!**

---

## 🎯 Core Metrics at a Glance

| Metric | Formula | What It Tells You |
|--------|---------|-------------------|
| **Total Revenue** | Sum of all confirmed booking amounts | Overall business performance |
| **ADR** | Total Revenue ÷ Total Nights Sold | Average price per room per night |
| **RevPAR** | Total Revenue ÷ Total Available Rooms | Revenue efficiency |
| **Occupancy Rate** | (Occupied Rooms ÷ Total Rooms) × 100 | Capacity utilization |
| **ALOS** | Total Nights ÷ Total Bookings | Average Length of Stay |
| **Repeat Guest Rate** | (Repeat Guests ÷ Total Guests) × 100 | Customer loyalty |
| **GLV** | Total Revenue from Guest ÷ 1 | Guest Lifetime Value |
| **Cancellation Rate** | (Cancellations ÷ Total Bookings) × 100 | Booking stability |

---

## 🗂️ File Structure Reference

```
src/
├── types/
│   └── analytics.ts                    # All TypeScript interfaces
│
├── services/
│   ├── analytics-service.ts            # Core analytics logic ⭐
│   ├── revenue-analytics.ts            # Revenue calculations
│   ├── occupancy-analytics.ts          # Occupancy calculations
│   ├── guest-analytics.ts              # Guest insights
│   └── export-service.ts               # Export functionality
│
├── pages/staff/
│   ├── AnalyticsPage.tsx               # Main dashboard ⭐
│   ├── RevenueAnalyticsPage.tsx        # Revenue details
│   ├── OccupancyAnalyticsPage.tsx      # Occupancy details
│   ├── GuestAnalyticsPage.tsx          # Guest insights
│   ├── PerformanceMetricsPage.tsx      # KPIs
│   └── FinancialReportsPage.tsx        # Financial data
│
├── components/analytics/
│   ├── KPICard.tsx                     # Metric display cards
│   ├── RevenueChart.tsx                # Revenue visualizations
│   ├── OccupancyHeatmap.tsx            # Calendar view
│   ├── TrendIndicator.tsx              # Trend arrows
│   ├── DateRangeSelector.tsx           # Date picker
│   ├── ExportButton.tsx                # Export dropdown
│   └── ComparisonToggle.tsx            # Period comparison
│
└── hooks/
    ├── use-analytics.ts                # Analytics data hook
    └── use-date-range.ts               # Date range state
```

---

## 📦 Essential Dependencies

```json
{
  "recharts": "^2.10.0",       // Charts
  "date-fns": "^2.30.0",        // Date handling
  "jspdf": "^2.5.1",            // PDF export
  "jspdf-autotable": "^3.8.0",  // PDF tables
  "xlsx": "^0.18.5"             // Excel export
}
```

**Install command:**
```bash
npm install recharts date-fns jspdf jspdf-autotable xlsx
```

---

## 🎨 Chart Types Mapping

| Data Type | Best Chart | Library Component |
|-----------|------------|-------------------|
| Revenue over time | Line Chart | `<LineChart>` |
| Revenue by room type | Pie/Donut Chart | `<PieChart>` |
| Payment methods | Bar Chart | `<BarChart>` |
| Occupancy trend | Area Chart | `<AreaChart>` |
| Occupancy calendar | Heatmap | Custom component |
| Top guests | Table | HTML table |
| KPI metrics | Card | Custom component |
| Comparison | Side-by-side bars | `<BarChart>` grouped |

---

## 🔑 Key Service Methods

### analyticsService

```typescript
// Revenue
await analyticsService.getRevenueAnalytics(startDate?, endDate?)
// Returns: RevenueAnalytics object

// Occupancy  
await analyticsService.getOccupancyAnalytics()
// Returns: OccupancyAnalytics object

// Guests
await analyticsService.getGuestAnalytics()
// Returns: GuestAnalytics object

// Performance
await analyticsService.getPerformanceMetrics()
// Returns: PerformanceMetrics object

// Financial
await analyticsService.getFinancialAnalytics()
// Returns: FinancialAnalytics object
```

---

## 🎯 Implementation Priority Order

1. **Revenue Analytics** ⭐⭐⭐ (Do first - highest impact)
2. **Occupancy Analytics** ⭐⭐⭐ (Do second - very important)
3. **Guest Analytics** ⭐⭐ (Do third - good insights)
4. **Performance Metrics** ⭐⭐ (Do fourth - benchmarking)
5. **Financial Reports** ⭐ (Do last - nice to have)

---

## 🚦 Status Filters

### Booking Status for Revenue
Include: `'confirmed'`, `'checked-in'`, `'checked-out'`  
Exclude: `'cancelled'`, `'reserved'` (pending)

### Booking Status for Occupancy
Include: `'confirmed'`, `'checked-in'`, `'reserved'`  
Exclude: `'cancelled'`, `'checked-out'` (historical)

---

## 📅 Date Range Presets

```typescript
const presets = {
  today: new Date(),
  yesterday: new Date(Date.now() - 86400000),
  thisWeek: new Date(Date.now() - 7 * 86400000),
  thisMonth: new Date(new Date().setDate(1)),
  lastMonth: new Date(new Date().setMonth(new Date().getMonth() - 1, 1)),
  thisYear: new Date(new Date().getFullYear(), 0, 1),
  last30Days: new Date(Date.now() - 30 * 86400000),
  last90Days: new Date(Date.now() - 90 * 86400000),
}
```

---

## 🎨 Color Palette

```typescript
// Trend colors
const POSITIVE = '#10b981' // green-500
const NEGATIVE = '#ef4444' // red-500
const NEUTRAL = '#6b7280'  // gray-500

// Chart colors
const CHART_COLORS = [
  '#0088FE', // blue
  '#00C49F', // teal
  '#FFBB28', // yellow
  '#FF8042', // orange
  '#8884D8', // purple
  '#82ca9d', // green
  '#ffc658', // gold
  '#ff7c7c', // coral
]
```

---

## 🔐 Permission Checks

```typescript
// In your component
import { usePermissions } from '@/hooks/use-permissions'

const permissions = usePermissions()

// Check access
if (!permissions.can('reports', 'read')) {
  return <AccessDenied />
}

// Conditional rendering
{permissions.can('reports', 'export') && (
  <ExportButton />
)}
```

---

## 🐛 Common Debugging Tips

### Issue: Revenue shows $0
**Check:**
- Booking status filter (include confirmed, checked-in, checked-out)
- `booking.amount` or `booking.totalPrice` field exists
- Data type is number, not string

### Issue: Occupancy shows 0%
**Check:**
- Total rooms calculation (should use properties table)
- Date comparison (use ISO string format)
- Status filter includes 'reserved'

### Issue: Charts not rendering
**Check:**
- ResponsiveContainer has explicit height
- Data array is not empty
- Data keys match chart dataKey props

### Issue: Slow performance
**Check:**
- Implement useMemo for calculations
- Add date range filters
- Paginate large lists
- Cache API responses

---

## 📊 Useful Code Snippets

### Calculate nights between dates
```typescript
const nights = Math.max(1, Math.ceil(
  (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
))
```

### Format currency
```typescript
const formatted = value.toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})
```

### Calculate percentage change
```typescript
const percentChange = ((current - previous) / previous) * 100
```

### Group by date
```typescript
const byDate = bookings.reduce((acc, booking) => {
  const date = booking.dates.checkIn.split('T')[0]
  acc[date] = (acc[date] || 0) + booking.amount
  return acc
}, {})
```

---

## 🎯 Testing Checklist

### Unit Tests
- [ ] Revenue calculations correct
- [ ] Occupancy rate accurate
- [ ] Date filtering works
- [ ] Guest segmentation logic
- [ ] Edge cases (zero bookings, etc.)

### Integration Tests
- [ ] Data fetching works
- [ ] Charts render with data
- [ ] Export generates files
- [ ] Filters update data

### UI Tests
- [ ] Mobile responsive
- [ ] Charts interactive
- [ ] Loading states work
- [ ] Error states display

### Performance Tests
- [ ] Dashboard loads < 2s
- [ ] Charts render < 1s
- [ ] Large datasets handled
- [ ] No memory leaks

---

## 📈 Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| Dashboard load time | < 2s | < 5s |
| Chart render time | < 1s | < 3s |
| Data fetch time | < 1s | < 3s |
| Export generation | < 5s | < 10s |
| Memory usage | < 100MB | < 200MB |

---

## 🚀 Launch Day Checklist

### Pre-Launch
- [ ] All analytics modules tested
- [ ] Mobile responsive verified
- [ ] Performance acceptable
- [ ] Error handling works
- [ ] Documentation complete
- [ ] Staff trained
- [ ] Backup plan ready

### Launch Day
- [ ] Deploy to production
- [ ] Monitor error logs
- [ ] Check performance metrics
- [ ] Verify data accuracy
- [ ] Staff available for questions
- [ ] Quick fixes ready if needed

### Post-Launch
- [ ] Collect user feedback
- [ ] Monitor usage analytics
- [ ] Fix any bugs
- [ ] Plan enhancements
- [ ] Celebrate success! 🎉

---

## 📞 Quick Links

- **Main Plan**: [ANALYTICS_SYSTEM_COMPREHENSIVE_PLAN.md](./ANALYTICS_SYSTEM_COMPREHENSIVE_PLAN.md)
- **Quick Start**: [ANALYTICS_QUICK_START_GUIDE.md](./ANALYTICS_QUICK_START_GUIDE.md)
- **Architecture**: [ANALYTICS_ARCHITECTURE_VISUAL.md](./ANALYTICS_ARCHITECTURE_VISUAL.md)
- **Executive Summary**: [ANALYTICS_EXECUTIVE_SUMMARY.md](./ANALYTICS_EXECUTIVE_SUMMARY.md)
- **Start Here**: [ANALYTICS_START_HERE.md](./ANALYTICS_START_HERE.md)

---

## 💡 Pro Tips

1. **Cache aggressively** - Analytics data doesn't change every second
2. **Load progressively** - Show KPIs first, charts second
3. **Default to 30 days** - Most useful time range for most users
4. **Export everything** - Users love downloading reports
5. **Mobile first** - Many managers check on phones
6. **Test with real data** - Mock data hides edge cases
7. **Add loading states** - Users need feedback
8. **Provide context** - Explain what each metric means
9. **Compare periods** - Show trends, not just numbers
10. **Celebrate wins** - Show positive trends prominently!

---

**Keep this handy during development!** 📌

---

**Version**: 1.0 | **Date**: October 18, 2025 | **Status**: Ready to Use ✅






