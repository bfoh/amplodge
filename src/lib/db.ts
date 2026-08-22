/**
 * Data-layer entrypoint.
 *
 * `db`   — table-CRUD wrapper (direct Supabase).
 * `auth` — Supabase Auth surface (signInWithEmail, signUp, me, logout, onAuthStateChanged).
 *
 * Both come from src/lib/supabase-wrapper.ts. Consumers stay on this stable surface.
 *
 * NOTE: `db` is intentionally typed as `any`. The pre-refactor codebase
 * silenced the wrapper's loose types with per-call-site `(db as any)`
 * casts (~80 sites). Centralising the cast here preserves identical
 * strictness behavior.
 */

import {
  db as _db,
  auth as _auth,
  onTableUpdated as _onTableUpdated,
} from './supabase-wrapper'

export { initRealtimeUpdates } from './supabase-wrapper'

import * as T from '../types'

export interface TableWrapper<TRow> {
  list(options?: {
    where?: Partial<Record<keyof TRow | string, any>>;
    limit?: number;
    offset?: number;
    orderBy?: any;
    include?: string[];
  }): Promise<TRow[]>
  listAll(options?: {
    where?: Partial<Record<keyof TRow | string, any>>;
    orderBy?: any;
    pageSize?: number;
  }): Promise<TRow[]>
  get(id: string): Promise<TRow>
  create(data: Partial<TRow>): Promise<TRow>
  update(id: string, data: Partial<TRow>): Promise<TRow>
  delete(id: string): Promise<boolean>
}

export type TypedDB = {
  staff: TableWrapper<T.Staff>
  roomTypes: TableWrapper<T.RoomType>
  guests: TableWrapper<T.Guest>
  bookings: TableWrapper<T.Booking>
  reservationsList: TableWrapper<any>
  bookingCharges: TableWrapper<T.BookingCharge>
  invoices: TableWrapper<T.Invoice>
  activityLogs: TableWrapper<T.ActivityLog>
  contactMessages: TableWrapper<T.ContactMessage>
  properties: TableWrapper<T.Property>
  hotelSettings: TableWrapper<T.HotelSettings>
  housekeepingTasks: TableWrapper<T.HousekeepingTask>
  notifications: TableWrapper<any>
  reviews: TableWrapper<any>
  channelConnections: TableWrapper<T.ChannelConnection>
  channelRoomMappings: TableWrapper<T.ChannelRoomMapping>
  externalBookings: TableWrapper<T.ExternalBooking>
  hr_attendance: TableWrapper<any>
  hr_leave_requests: TableWrapper<any>
  hr_payroll: TableWrapper<any>
  hr_performance_reviews: TableWrapper<any>
  hr_job_applications: TableWrapper<any>
  hr_weekly_revenue: TableWrapper<any>
  staff_device_bindings: TableWrapper<any>
  attendance_override_requests: TableWrapper<any>
  standaloneSales: TableWrapper<T.StandaloneSale>
  inventory: TableWrapper<T.InventoryItem>
  inventoryTransactions: TableWrapper<T.InventoryTransaction>
  bookingGroups: TableWrapper<T.BookingGroup>
} & Record<string, TableWrapper<any>>

export const db: TypedDB = _db as unknown as TypedDB
export const auth = _auth
export const onTableUpdated = _onTableUpdated
