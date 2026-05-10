import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy, useEffect, useState, useRef } from 'react'
import { Toaster } from 'sonner'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { db, auth } from '@/lib/db'
import { activityLogService } from './services/activity-log-service'
import { StaffLoginPage } from './pages/staff/StaffLoginPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
// Staff routes are lazy-loaded so the public marketing site doesn't pay
// the cost of recharts, invoice services, etc. on first paint. The existing
// <Suspense> below already covers them.
const lazyWithRetry = (componentImport: () => Promise<any>) =>
  lazy(() =>
    componentImport().catch((error) => {
      const errorMsg = error?.message || '';
      // Only reload if it's a chunk load error (common after new deployments)
      if (/failed to fetch dynamically imported module|loading chunk/i.test(errorMsg)) {
        console.warn('🔄 [App] Chunk load failed. Forcing refresh to get latest version...', errorMsg);
        window.location.reload();
        return { default: () => null }; // Return dummy to prevent crash while reloading
      }
      throw error;
    })
  );

const DashboardPage = lazyWithRetry(() => import('./pages/staff/DashboardPage').then(m => ({ default: m.DashboardPage })))
const StaffCalendarPage = lazyWithRetry(() => import('./pages/staff/CalendarPage').then(m => ({ default: m.CalendarPage })))
const PropertiesPage = lazyWithRetry(() => import('./pages/staff/PropertiesPage').then(m => ({ default: m.PropertiesPage })))
const StaffBookingsPage = lazyWithRetry(() => import('./pages/staff/BookingsPage').then(m => ({ default: m.BookingsPage })))
const StaffGuestsPage = lazyWithRetry(() => import('./pages/staff/GuestsPage').then(m => ({ default: m.GuestsPage })))
const ChannelsPage = lazyWithRetry(() => import('./pages/staff/ChannelsPage').then(m => ({ default: m.ChannelsPage })))
const ReportsPage = lazyWithRetry(() => import('./pages/staff/ReportsPage').then(m => ({ default: m.ReportsPage })))
const SettingsPage = lazyWithRetry(() => import('./pages/staff/SettingsPage').then(m => ({ default: m.SettingsPage })))
const SetPricesPage = lazyWithRetry(() => import('./pages/staff/SetPricesPage').then(m => ({ default: m.SetPricesPage })))
const StaffReservationsPage = lazyWithRetry(() => import('./pages/staff/ReservationsPage').then(m => ({ default: m.ReservationsPage })))
const ReservationHistoryPage = lazyWithRetry(() => import('./pages/staff/ReservationHistoryPage').then(m => ({ default: m.ReservationHistoryPage })))
const HousekeepingPage = lazyWithRetry(() => import('./pages/staff/HousekeepingPage'))
const EmployeesPage = lazyWithRetry(() => import('./pages/staff/EmployeesPage').then(m => ({ default: m.EmployeesPage })))
const CleanupToolPage = lazyWithRetry(() => import('./pages/staff/CleanupToolPage').then(m => ({ default: m.CleanupToolPage })))
const OnsiteBookingPage = lazyWithRetry(() => import('./pages/staff/OnsiteBookingPage').then(m => ({ default: m.OnsiteBookingPage })))
const TaskCompletionPage = lazyWithRetry(() => import('./pages/TaskCompletionPage').then(m => ({ default: m.TaskCompletionPage })))
const InvoicePage = lazyWithRetry(() => import('./pages/InvoicePage').then(m => ({ default: m.InvoicePage })))
const InvoicesPage = lazyWithRetry(() => import('./pages/staff/InvoicesPage').then(m => ({ default: m.InvoicesPage })))
const ReviewSubmissionPage = lazyWithRetry(() => import('./pages/ReviewSubmissionPage').then(m => ({ default: m.ReviewSubmissionPage })))
const AnalyticsPage = lazyWithRetry(() => import('./pages/staff/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))
const ActivityLogsPage = lazyWithRetry(() => import('./pages/staff/ActivityLogsPage').then(m => ({ default: m.ActivityLogsPage })))
const DiagnoseEmailPage = lazyWithRetry(() => import('./pages/staff/DiagnoseEmailPage').then(m => ({ default: m.DiagnoseEmailPage })))
const ReviewsPage = lazyWithRetry(() => import('./pages/staff/ReviewsPage').then(m => ({ default: m.ReviewsPage })))
const MarketingPage = lazyWithRetry(() => import('./pages/staff/MarketingPage'))
const ServiceRequestsPage = lazyWithRetry(() => import('./pages/staff/ServiceRequestsPage').then(m => ({ default: m.ServiceRequestsPage })))
const HRPage = lazyWithRetry(() => import('./pages/staff/HRPage').then(m => ({ default: m.HRPage })))
const MyRevenuePage = lazyWithRetry(() => import('./pages/staff/MyRevenuePage').then(m => ({ default: m.MyRevenuePage })))
const ClockPage = lazyWithRetry(() => import('./pages/staff/ClockPage').then(m => ({ default: m.ClockPage })))
const InventoryPage = lazyWithRetry(() => import('./pages/staff/InventoryPage').then(m => ({ default: m.InventoryPage })))
const InventoryTransactionsPage = lazyWithRetry(() => import('./pages/staff/InventoryTransactionsPage').then(m => ({ default: m.InventoryTransactionsPage })))
// Guest portal + voice widget are lazy-loaded too — most visits to /staff/*
// never touch them, so shipping them up-front wastes bandwidth (especially
// painful on Ghanaian mobile networks).
const GuestLayout = lazyWithRetry(() => import('./layouts/GuestLayout'))
const GuestDashboard = lazyWithRetry(() => import('./pages/guest/GuestDashboard'))
const ConciergePage = lazyWithRetry(() => import('./pages/guest/ConciergePage').then(m => ({ default: m.ConciergePage })))
const ServicesPage = lazyWithRetry(() => import('./pages/guest/ServicesPage').then(m => ({ default: m.ServicesPage })))
const GuestLoginPage = lazyWithRetry(() => import('./pages/guest/GuestLoginPage').then(m => ({ default: m.GuestLoginPage })))
const VoiceWidget = lazyWithRetry(() => import('./components/voice-agent/VoiceWidget'))

const HomePage = lazyWithRetry(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })))
const RoomsPage = lazyWithRetry(() => import('./pages/RoomsPage').then(m => ({ default: m.RoomsPage })))
const GalleryPage = lazyWithRetry(() => import('./pages/GalleryPage').then(m => ({ default: m.GalleryPage })))
const ContactPage = lazyWithRetry(() => import('./pages/ContactPage').then(m => ({ default: m.ContactPage })))
const BookingPage = lazyWithRetry(() => import('./pages/BookingPage').then(m => ({ default: m.BookingPage })))
const VirtualTourPage = lazyWithRetry(() => import('./pages/VirtualTourPage').then(m => ({ default: m.VirtualTourPage })))

import { BookingCartProvider } from './context/BookingCartContext'

function App() {
  const [adminSeeded, setAdminSeeded] = useState(() => {
    try {
      return localStorage.getItem('adminSeeded') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    import('./services/test-group-booking').then(({ testGroupBooking }) => {
      (window as any).testGroupBooking = testGroupBooking
      console.log('🧪 `testGroupBooking()` is available in the console for verification.')
    })

    const initializeApp = async () => {
      try {
        console.log('🚀 App running with Supabase backend')

        console.log('📝 Initializing activity log service...')
        try {
          const currentUser = await auth.me()
          if (currentUser) {
            activityLogService.setCurrentUser(currentUser.id)
            console.log('✅ Activity log service initialized with user:', currentUser.email)
          } else {
            activityLogService.setCurrentUser('system')
            console.log('✅ Activity log service initialized with system user')
          }
        } catch (error) {
          console.warn('⚠️ Failed to initialize activity log service with user, using system:', error)
          activityLogService.setCurrentUser('system')
        }
      } catch (error) {
        console.error('❌ Failed to initialize app:', error)
      }
    }
    initializeApp()
  }, [adminSeeded])
  const hasCheckedAdminRef = useRef(false)

  useEffect(() => {
    let isCreating = false

    const ensureAdminStaffRecord = async (userId: string, email: string) => {
      if (hasCheckedAdminRef.current || isCreating) return
      try {
        isCreating = true
        const existingStaff = await db.staff.list({ where: { user_id: userId } })

        if (!existingStaff || existingStaff.length === 0) {
          await db.staff.create({
            user_id: userId,
            name: 'Admin User',
            email,
            role: 'admin',
          })
        }
        hasCheckedAdminRef.current = true
      } catch (error) {
        console.log('ℹ️ [App] Admin staff record error:', error)
      } finally {
        isCreating = false
      }
    }

    const unsubscribe = auth.onAuthStateChanged(async (state) => {
      if (!state.isLoading) {
        if (state.user?.id) {
          activityLogService.setCurrentUser(state.user.id)
          console.log('📝 [App] Activity log service updated with user:', state.user.email)
          
          if (state.user?.email === import.meta.env.VITE_ADMIN_EMAIL) {
            await ensureAdminStaffRecord(state.user.id, state.user.email)
          }
        } else {
          activityLogService.setCurrentUser('system')
          console.log('📝 [App] Activity log service updated with system user')
        }
      }
    })

    return unsubscribe
  }, [])

  return (
    <ErrorBoundary>
      <BookingCartProvider>
        <BrowserRouter>
          <Toaster position="top-right" />
          <VoiceWidget />
          <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
            <Routes>
              {/* Guest Portal Routes */}
              <Route path="/guest" element={<GuestLoginPage />} />
              <Route path="/guest/:token" element={<GuestLayout />}>
                <Route index element={<GuestDashboard />} />
                <Route path="concierge" element={<ConciergePage />} />
                <Route path="services" element={<ServicesPage />} />
                <Route path="help" element={<ServicesPage />} />
              </Route>

              {/* Guest Portal - Legacy/Public Web Handling */}
              <Route
                path="/*"
                element={
                  <div className="flex flex-col min-h-screen">
                    <Navbar />
                    <main className="flex-1">
                      <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/rooms" element={<RoomsPage />} />
                        <Route path="/gallery" element={<GalleryPage />} />
                        <Route path="/virtual-tour" element={<VirtualTourPage />} />
                        <Route path="/contact" element={<ContactPage />} />
                        <Route path="/booking" element={<BookingPage />} />
                      </Routes>
                    </main>
                    <Footer />
                  </div>
                }
              />

              {/* Staff Login Page - Public */}
              <Route path="/staff/login" element={<StaffLoginPage />} />

              {/* Staff Clock-In/Out - Protected, no sidebar */}
              <Route path="/staff/clock" element={<ProtectedRoute><ClockPage /></ProtectedRoute>} />

              {/* Staff Portal - Protected Routes */}
              <Route path="/staff" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route index element={<Navigate to="/staff/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="calendar" element={<StaffCalendarPage />} />
                <Route path="properties" element={<PropertiesPage />} />
                <Route path="bookmarks" element={<Navigate to="/staff/bookings" replace />} />
                <Route path="bookings" element={<StaffBookingsPage />} />
                <Route path="onsite" element={<OnsiteBookingPage />} />
                <Route path="reservations" element={<StaffReservationsPage />} />
                <Route path="reservations/history" element={<ReservationHistoryPage />} />
                <Route path="guests" element={<StaffGuestsPage />} />
                <Route path="housekeeping" element={<HousekeepingPage />} />
                <Route path="employees" element={<EmployeesPage />} />
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="cleanup" element={<CleanupToolPage />} />
                <Route path="channels" element={<ChannelsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="activity-logs" element={<ActivityLogsPage />} />
                <Route path="email-diagnostics" element={<DiagnoseEmailPage />} />
                <Route path="set-prices" element={<SetPricesPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="reviews" element={<ReviewsPage />} />
                <Route path="marketing" element={<MarketingPage />} />
                <Route path="requests" element={<ServiceRequestsPage />} />
                <Route path="hr" element={<HRPage />} />
                <Route path="my-revenue" element={<MyRevenuePage />} />
                <Route path="inventory" element={<InventoryPage />} />
                <Route path="inventory/transactions" element={<InventoryTransactionsPage />} />
              </Route>

              {/* Invoice debug route */}
              <Route path="/invoice-debug" element={<InvoicePage />} />

              {/* External task completion route */}
              <Route path="/task-complete/:taskId" element={<TaskCompletionPage />} />

              {/* External invoice route */}
              <Route path="/invoice/:invoiceNumber" element={<InvoicePage />} />

              {/* Public Review Link */}
              <Route path="/review" element={<ReviewSubmissionPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </BookingCartProvider>
    </ErrorBoundary>
  )
}

export default App
