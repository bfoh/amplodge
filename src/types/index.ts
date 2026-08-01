export type StaffRole = 'staff' | 'manager' | 'admin' | 'owner'

export interface RoomType {
  id: string
  name: string
  description: string
  basePrice: number
  capacity: number
  amenities: string
  imageUrl: string
  createdAt: string
  updatedAt?: string
}


export interface Guest {
  id: string
  userId?: string
  user_id?: string // Legacy
  name: string
  email: string
  phone?: string
  address?: string
  last_booking_date?: string // Legacy
  last_room_number?: string // Legacy
  last_check_in?: string // Legacy
  last_check_out?: string // Legacy
  last_source?: string // Legacy
  total_revenue?: number // Legacy
  total_stays?: number // Legacy
  createdAt: string
  updatedAt?: string
}

export interface PaymentSplit {
  method: 'cash' | 'mobile_money' | 'card'
  amount: number
}

export interface Booking {
  id: string
  userId?: string
  guestId: string
  roomId: string
  checkIn: string
  checkOut: string
  status: string
  totalPrice: number
  numGuests: number
  specialRequests?: string
  actualCheckIn?: string
  actualCheckOut?: string
  createdAt: string
  paymentMethod?: string
  invoiceNumber?: string
  // Payment tracking fields
  amountPaid?: number          // Amount guest has paid so far
  paymentStatus?: 'full' | 'part' | 'pending'  // Payment status
  // Discount fields
  discountAmount?: number      // Discount applied at check-in (in GH₵)
  discountReason?: string      // Reason for discount
  finalAmount?: number         // Amount after discount (totalPrice - discountAmount)
  discountedBy?: string        // Staff ID who applied discount
  paymentSplits?: PaymentSplit[] // Per-method amounts when guest pays with multiple methods

  // Group Booking Fields
  groupId?: string             // Shared ID for all bookings in a group
  groupReference?: string      // Human readable reference (e.g. GRP-2024-ABCD)
  isPrimaryBooking?: boolean   // True if this is the main booking record for the group
  checkOutBy?: string          // Staff ID who performed check-out
  checkOutByName?: string      // Name of staff who performed check-out
  special_requests?: string    // Legacy field for JSON snapshots

  billingContact?: {
    fullName: string
    email: string
    phone: string
    address: string
  }
}

export interface BillingContact {
  fullName: string
  email: string
  phone: string
  address: string
}

export interface AdditionalCharge {
  id?: string
  description: string
  amount: number
}

export interface GroupDiscount {
  type: 'percentage' | 'fixed'
  value: number
  amount?: number
}

// A group booking (multiple rooms under one reservation). Bookings that
// belong to a group carry this row's id in Booking.groupId.
export interface BookingGroup {
  id: string
  groupReference: string
  billingContact?: BillingContact
  additionalCharges?: AdditionalCharge[]
  discount?: GroupDiscount
  primaryBookingId?: string
  invoiceNumber?: string
  status: 'active' | 'cancelled'
  createdBy?: string
  createdByName?: string
  createdAt: string
  updatedAt: string
}

export interface CartItem {
  tempId: string
  roomTypeId: string
  roomTypeName: string
  checkIn: Date
  checkOut: Date
  numGuests: number
  price: number
  guest?: {
    name: string
    email?: string // Optional for secondary guests
  }
}

export interface Staff {
  id: string
  userId: string
  user_id?: string // Legacy
  name: string
  email: string
  phone?: string
  role: StaffRole
  createdAt: string
}

export interface ContactMessage {
  id: string
  userId?: string
  name: string
  email: string
  message: string
  status: string
  createdAt: string
}

export interface Invoice {
  id: string
  userId?: string
  bookingId: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  guestName: string
  guestEmail: string
  guestPhone?: string
  guestAddress?: string
  roomNumber: string
  roomType: string
  checkIn: string
  checkOut: string
  nights: number
  numGuests: number
  roomRate: number
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  status: string
  pdfUrl?: string
  sentAt?: string
  invoiceType?: string
  symbol?: string
  manualNumber?: string
  dateOfIssue?: string
  dateOfSale?: string
  placeOfIssue?: string
  currency?: string
  totalAmount?: string
  createdAt: string
}

export interface InvoiceData {
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  guest: {
    name: string
    email: string
    phone?: string
    address?: string
  }
  booking: {
    id: string
    roomNumber: string
    roomType: string
    checkIn: string
    checkOut: string
    nights: number
    numGuests: number
  }
  charges: {
    roomRate: number
    nights: number
    subtotal: number
    taxRate: number
    taxAmount: number
    total: number
  }
  hotel: {
    name: string
    address: string
    phone: string
    email: string
    website: string
  }
}

export interface HousekeepingTask {
  id: string
  propertyId: string
  userId?: string // Original creator (optional)
  roomNumber: string
  assignedTo: string | null      // Primary/first assignee (back-compat)
  assignedToIds?: string[]       // All assignees (multi-staff). Falls back to [assignedTo] when empty.
  status: 'pending' | 'in_progress' | 'completed'
  notes: string | null
  createdAt: string
  completedAt: string | null
}

// Charge categories for guest additional charges
export type ChargeCategory = 'food_beverage' | 'room_service' | 'minibar' | 'laundry' | 'phone_internet' | 'parking' | 'room_extension' | 'other'

// Booking charge for additional services during guest stay
export interface BookingCharge {
  id: string
  bookingId: string
  description: string
  category: ChargeCategory
  quantity: number
  unitPrice: number
  amount: number // quantity × unitPrice
  notes?: string
  inventoryId?: string
  paymentMethod?: string  // 'cash' | 'mobile_money' | 'card'
  createdAt: string
  createdBy?: string
  updatedAt?: string
}

// Channel Manager Types
export interface ChannelConnection {
  id: string
  channelId: 'airbnb' | 'booking' | 'expedia' | 'vrbo' | 'tripadvisor' | 'hotels'
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ChannelRoomMapping {
  id: string
  channelConnectionId: string
  localRoomTypeId: string
  importUrl?: string
  exportToken: string
  lastSyncedAt?: string
  syncStatus: 'pending' | 'success' | 'error'
  syncMessage?: string
  createdAt: string
  updatedAt: string
}

export interface ExternalBooking {
  id: string
  mappingId: string
  externalId: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  summary?: string
  rawData?: any
  createdAt: string
  updatedAt: string
}

// Rooms and properties are the same table in this schema; several pages
// import the domain-friendly `Room` name.
export type Room = Property

export interface Property {
  id: string
  name: string
  type: string
  status: string
  price: number
  displayPrice?: number    // Used by stay-extension-service
  pricePerNight?: number   // Used by stay-extension-service
  roomNumber?: string
  roomTypeId?: string
  imageUrls: string
  basePrice?: number // Added for SetPricesPage
  propertyTypeId?: string
  property_type_id?: string
  createdAt: string
  updatedAt: string
}

export interface HotelSettings {
  id: string
  hotelName: string
  address: string
  phone: string
  email: string
  website: string
  currency: string
  taxRate: number
  checkInTime: string
  checkOutTime: string
  updatedAt: string
}

export type ActivityAction = 'created' | 'updated' | 'deleted' | 'cancelled' | 'restored' | 'confirmed' | 'checked-in' | 'checked-out' | 'checked_in' | 'checked_out' | 'payment_recorded' | 'payment_received' | 'payment_refunded' | 'status_changed' | 'assigned' | 'completed' | 'exported' | 'imported' | 'login' | 'logout' | 'sync_completed' | 'notified' | 'diagnostic' | 'table_init' | 'verify_write' | 'manual_entry' | 'record_voided' | 'record_adjusted' | 'record_reviewed' | 'override_approved' | 'override_rejected' | 'device_reset' | 'shift_changed' | 'settings_changed'
export type EntityType = 'booking' | 'room' | 'room_type' | 'guest' | 'invoice' | 'employee' | 'staff' | 'property' | 'settings' | 'inventory' | 'payment' | 'task' | 'contact_message' | 'report' | 'user' | 'housekeeping_task' | 'system' | 'test' | 'diagnostic' | 'attendance'

export interface ActivityLog {
  id: string
  action: ActivityAction
  entityType: EntityType
  entityId: string
  details: any
  userId: string
  metadata?: any
  createdAt: string
}

export interface InventoryItem {
  id: string
  name: string
  description?: string
  category: string
  unit?: string
  stockQuantity: number
  minThreshold: number
  unitPrice: number
  costPrice?: number
  createdAt: string
  updatedAt: string
}

export interface InventoryTransaction {
  id: string
  inventoryId: string
  type: 'sale' | 'restock' | 'adjustment' | 'in' | 'out'
  quantity: number
  remainingStock?: number
  staffId?: string
  staffName?: string
  userId?: string
  notes?: string
  reason?: string
  createdAt: string
}

export interface StandaloneSale {
  id: string
  description: string
  category: 'food_beverage' | 'room_service' | 'minibar' | 'other'
  quantity: number
  unitPrice: number
  amount: number
  notes: string
  staffId: string
  staffName: string
  saleDate: string          // YYYY-MM-DD
  paymentMethod: 'cash' | 'mobile_money' | 'card'
  createdAt: string
  inventoryId?: string
}

