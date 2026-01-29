import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { blink } from './blink/client'
import { initializeDatabaseSchema } from './blink/database-schema'
import { activityLogService } from './services/activity-log-service'
import { StaffLoginPage } from './pages/staff/StaffLoginPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DashboardPage } from './pages/staff/DashboardPage'
import { CalendarPage as StaffCalendarPage } from './pages/staff/CalendarPage'
import { PropertiesPage } from './pages/staff/PropertiesPage'
import { BookingsPage as StaffBookingsPage } from './pages/staff/BookingsPage'
import { GuestsPage as StaffGuestsPage } from './pages/staff/GuestsPage'
import { ChannelsPage } from './pages/staff/ChannelsPage'
import { ReportsPage } from './pages/staff/ReportsPage'
import { SettingsPage } from './pages/staff/SettingsPage'
import { SetPricesPage } from './pages/staff/SetPricesPage'
import { ReservationsPage as StaffReservationsPage } from './pages/staff/ReservationsPage'
import { ReservationHistoryPage } from './pages/staff/ReservationHistoryPage'
import HousekeepingPage from './pages/staff/HousekeepingPage'
import { EmployeesPage } from './pages/staff/EmployeesPage'
import { CleanupToolPage } from './pages/staff/CleanupToolPage'
import { OnsiteBookingPage } from './pages/staff/OnsiteBookingPage'
import { TaskCompletionPage } from './pages/TaskCompletionPage'
import { InvoicePage } from './pages/InvoicePage'
import { InvoicesPage } from './pages/staff/InvoicesPage'
import { ReviewSubmissionPage } from './pages/ReviewSubmissionPage'
import { AnalyticsPage } from './pages/staff/AnalyticsPage'
import { ActivityLogsPage } from './pages/staff/ActivityLogsPage'
import { DiagnoseEmailPage } from './pages/staff/DiagnoseEmailPage'
import { ReviewsPage } from './pages/staff/ReviewsPage'
import MarketingPage from './pages/staff/MarketingPage'
import { ServiceRequestsPage } from './pages/staff/ServiceRequestsPage'
import GuestLayout from './layouts/GuestLayout'
import GuestDashboard from './pages/guest/GuestDashboard'
import { ConciergePage } from './pages/guest/ConciergePage'
import { ServicesPage } from './pages/guest/ServicesPage'
import { GuestLoginPage } from './pages/guest/GuestLoginPage'
import VoiceWidget from './components/voice-agent/VoiceWidget'

const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })))
const RoomsPage = lazy(() => import('./pages/RoomsPage').then(m => ({ default: m.RoomsPage })))
const GalleryPage = lazy(() => import('./pages/GalleryPage').then(m => ({ default: m.GalleryPage })))
const ContactPage = lazy(() => import('./pages/ContactPage').then(m => ({ default: m.ContactPage })))
const BookingPage = lazy(() => import('./pages/BookingPage').then(m => ({ default: m.BookingPage })))
const VirtualTourPage = lazy(() => import('./pages/VirtualTourPage').then(m => ({ default: m.VirtualTourPage })))

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
        console.log('🔧 Initializing database schema...')
        await initializeDatabaseSchema()
        console.log('✅ Database schema initialized')

        console.log('📝 Initializing activity log service...')
        try {
          const currentUser = await blink.auth.me()
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

  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const currentUser = await blink.auth.me()
        if (currentUser) {
          activityLogService.setCurrentUser(currentUser.id)
          console.log('📝 [App] Activity log service updated with user:', currentUser.email)
        } else {
          activityLogService.setCurrentUser('system')
          console.log('📝 [App] Activity log service updated with system user')
        }
      } catch (error) {
        console.warn('⚠️ [App] Failed to check auth status for activity log service:', error)
        activityLogService.setCurrentUser('system')
      }
    }

    checkAuthStatus()
    const interval = setInterval(checkAuthStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let isCreating = false

    const ensureAdminStaffRecord = async (userId: string, email: string) => {
      if (isCreating) return
      try {
        isCreating = true
        const existingStaff = await (blink.db as any).staff.list({ where: { userId } })

        if (!existingStaff || existingStaff.length === 0) {
          await (blink.db as any).staff.create({
            id: `staff_admin_${Date.now()}`,
            userId,
            name: 'Admin User',
            email,
            role: 'admin',
            createdAt: new Date().toISOString()
          })
        }
      } catch (error) {
        console.log('ℹ️ [App] Admin staff record error:', error)
      } finally {
        isCreating = false
      }
    }

    const unsubscribe = blink.auth.onAuthStateChanged(async (state) => {
      if (!state.isLoading && state.user?.email === import.meta.env.VITE_ADMIN_EMAIL && state.user?.id) {
        await ensureAdminStaffRecord(state.user.id, state.user.email)
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
