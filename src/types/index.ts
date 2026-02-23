export interface RoomType {
  id: string
  name: string
  description: string
  basePrice: number
  capacity: number
  amenities: string
  imageUrl: string
  createdAt: string
}

export interface Room {
  id: string
  roomNumber: string
  roomTypeId: string
  status: string
  price: number
  imageUrls: string
  createdAt: string
}

export interface Guest {
  id: string
  userId?: string
  name: string
  email: string
  phone?: string
  address?: string
  createdAt: string
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

  // Group Booking Fields
  groupId?: string             // Shared ID for all bookings in a group
  groupReference?: string      // Human readable reference (e.g. GRP-2024-ABCD)
  isPrimaryBooking?: boolean   // True if this is the main booking record for the group

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
  name: string
  email: string
  phone?: string
  role: string
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
  assignedTo: string | null
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
