// Staff AI Assistant — LLM orchestration only.
//
// This function NEVER executes a booking/check-in/etc. action itself. It is a
// stateless proxy: the client sends the running Claude conversation `history`,
// this function calls the Anthropic Messages API with the staff tool schema,
// and returns either plain text or a proposed { id, name, args } tool call
// for the client to run against the app's own services
// (src/services/staff-assistant-tools.ts), under the staff member's own
// authenticated Supabase session so the same RLS/RBAC boundaries the rest of
// the app relies on still apply. Keeping execution client-side avoids
// duplicating booking-engine.ts, useCheckIn, stay-extension-service.ts, etc.
// on the server.
import Anthropic from '@anthropic-ai/sdk'
import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js'
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js'

const STAFF_TOOLS = [
  // --- Read-only: execute immediately client-side, no confirmation ---
  {
    name: 'checkAvailability',
    description: 'Check which rooms are available for a date range. Read-only — runs immediately, no confirmation needed.',
    input_schema: {
      type: 'object',
      properties: {
        checkIn: { type: 'string', description: 'Check-in date, YYYY-MM-DD' },
        checkOut: { type: 'string', description: 'Check-out date, YYYY-MM-DD' },
        roomTypeName: { type: 'string', description: 'Optional room type name to filter by, e.g. "Deluxe Room". Omit to check all types.' },
        guests: { type: 'number', description: 'Optional number of guests' },
      },
      required: ['checkIn', 'checkOut'],
    },
  },
  {
    name: 'lookupGuest',
    description: 'Search for a guest by name, email, or phone. Read-only — runs immediately.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name, email, or phone fragment to search for' } },
      required: ['query'],
    },
  },
  {
    name: 'getBookingStatus',
    description: 'Look up an existing booking (status, dates, room, payment) by guest name or room number. Read-only — runs immediately.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Guest name, room number, or booking reference' } },
      required: ['query'],
    },
  },
  {
    name: 'getTodaysArrivals',
    description: "List guests scheduled to check in today. Read-only — runs immediately.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getTodaysDepartures',
    description: "List guests scheduled to check out today (currently checked in). Read-only — runs immediately.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getRoomStatusOverview',
    description: 'Current counts of rooms by status (available, occupied, cleaning, maintenance). Read-only — runs immediately, any staff can ask.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getMyRevenue',
    description: "The asking staff member's OWN revenue (bookings they created, checked in, or checked out) for a period. Read-only — runs immediately, any staff can ask about their own figures.",
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisYear'], description: 'Defaults to today if omitted' },
      },
    },
  },

  // --- Read-only, admin/manager only: staff asking about these gets a permission-denied reply, no card shown ---
  {
    name: 'getStaffRevenue',
    description: "ADMIN/MANAGER ONLY. A named staff member's revenue for a period. Read-only.",
    input_schema: {
      type: 'object',
      properties: {
        staffName: { type: 'string', description: 'Staff member name or email, as said' },
        period: { type: 'string', enum: ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisYear'] },
      },
      required: ['staffName'],
    },
  },
  {
    name: 'getAllStaffRevenue',
    description: 'ADMIN/MANAGER ONLY. Every staff member\'s revenue for a period, ranked highest first. Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisYear'] },
      },
    },
  },
  {
    name: 'getHotelRevenue',
    description: 'ADMIN/MANAGER ONLY. Hotel-wide revenue figures for a period: total, by room type, by payment method, by booking source, ADR, RevPAR. Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'thisWeek', 'thisMonth', 'thisYear', 'lastMonth', 'lastYear'], description: 'Defaults to today' },
      },
    },
  },
  {
    name: 'getHotelStats',
    description: 'ADMIN/MANAGER ONLY. Current hotel statistics: occupancy rate, ADR, RevPAR, average length of stay, booking lead time, cancellation rate, and a 7/30/90-day booking forecast. Read-only.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getActivitySummary',
    description: 'ADMIN/MANAGER ONLY. Historical activity summary for a period — counts by action type (bookings created, check-ins, check-outs, cancellations, etc.) plus the most recent notable entries. Use this for "what happened" / historic-events style questions. Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisYear'] },
      },
    },
  },
  {
    name: 'listBookings',
    description: 'ADMIN/MANAGER ONLY. List bookings/reservations created in a period, optionally filtered by status (confirmed, checked-in, checked-out, cancelled, reserved). Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisYear'] },
        status: { type: 'string', description: 'Optional status filter' },
      },
    },
  },

  // --- Write actions: staff must tap Confirm on an action card before these run ---
  {
    name: 'createBooking',
    description: 'Create a new reservation. This is a WRITE action — the staff member will see a confirmation card and must approve it before it happens.',
    input_schema: {
      type: 'object',
      properties: {
        guestName: { type: 'string', description: "Guest's full name" },
        guestEmail: { type: 'string', description: "Guest's email — REQUIRED. Used to send the booking confirmation and, later, the checkout invoice. Ask the staff member for it before calling this tool if they haven't given it." },
        guestPhone: { type: 'string', description: "Guest's phone — strongly recommended, used for SMS confirmations. Ask for it too if not given." },
        roomNumberOrType: { type: 'string', description: 'Room number (e.g. "105") or room type name (e.g. "Deluxe Room")' },
        checkIn: { type: 'string', description: 'Check-in date, YYYY-MM-DD' },
        checkOut: { type: 'string', description: 'Check-out date, YYYY-MM-DD' },
        guests: { type: 'number', description: 'Number of guests' },
        paymentMethod: { type: 'string', description: 'cash, mobile_money, or card. Omit if nothing paid yet.' },
        amountCollected: { type: 'number', description: 'Amount collected now, if any. Omit or 0 for pay-later.' },
      },
      required: ['guestName', 'guestEmail', 'roomNumberOrType', 'checkIn', 'checkOut', 'guests'],
    },
  },
  {
    name: 'checkInGuest',
    description: 'Check a guest into their room. WRITE action requiring confirmation. Pass the raw guest name / room number / booking reference exactly as the staff member said it — do not normalize or guess an ID yourself, the matching happens client-side.',
    input_schema: {
      type: 'object',
      properties: {
        guestNameOrBookingRef: { type: 'string', description: 'Guest name, room number, or booking reference as the staff member said it' },
        paymentMethod: { type: 'string', description: 'cash, mobile_money, or card' },
        amountCollected: { type: 'number', description: 'Amount collected at check-in' },
        discountAmount: { type: 'number', description: 'Discount to apply, if any' },
        discountReason: { type: 'string', description: 'Reason for the discount, if any' },
      },
      required: ['guestNameOrBookingRef', 'paymentMethod'],
    },
  },
  {
    name: 'checkOutGuest',
    description: 'Check a guest out, generate their invoice, and send it. WRITE action requiring confirmation.',
    input_schema: {
      type: 'object',
      properties: { guestNameOrBookingRef: { type: 'string', description: 'Guest name, room number, or booking reference as said' } },
      required: ['guestNameOrBookingRef'],
    },
  },
  {
    name: 'extendStay',
    description: "Extend a checked-in guest's stay to a new checkout date, optionally moving them to a different room. WRITE action requiring confirmation.",
    input_schema: {
      type: 'object',
      properties: {
        guestNameOrBookingRef: { type: 'string', description: 'Guest name, room number, or booking reference as said' },
        newCheckoutDate: { type: 'string', description: 'New check-out date, YYYY-MM-DD' },
        newRoomNumber: { type: 'string', description: 'Optional — only if moving the guest to a different room' },
        discountAmount: { type: 'number', description: 'Discount on the extension, if any' },
        discountReason: { type: 'string', description: 'Reason for the discount, if any' },
      },
      required: ['guestNameOrBookingRef', 'newCheckoutDate'],
    },
  },
  {
    name: 'createGroupBooking',
    description: 'Create a group booking with multiple rooms under one billing contact. WRITE action requiring confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        billingContactName: { type: 'string', description: 'Name of the person/company being billed for the group' },
        billingContactEmail: { type: 'string', description: 'Billing contact email — REQUIRED, used to send the group invoice. Ask for it if not given.' },
        billingContactPhone: { type: 'string', description: 'Billing contact phone (optional)' },
        rooms: {
          type: 'array',
          description: 'One entry per room in the group',
          items: {
            type: 'object',
            properties: {
              roomNumberOrType: { type: 'string' },
              guestName: { type: 'string' },
              guestEmail: { type: 'string', description: "This room's guest's email — REQUIRED for their booking confirmation. Ask for each guest's email before calling this tool." },
              guestPhone: { type: 'string', description: "This room's guest's phone (optional but recommended)" },
              checkIn: { type: 'string' },
              checkOut: { type: 'string' },
              guests: { type: 'number' },
            },
            required: ['roomNumberOrType', 'guestName', 'guestEmail', 'checkIn', 'checkOut', 'guests'],
          },
        },
      },
      required: ['billingContactName', 'billingContactEmail', 'rooms'],
    },
  },
  {
    name: 'addRoomToGroup',
    description: 'Add another room to an existing group booking. WRITE action requiring confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        groupReference: { type: 'string', description: 'The group booking reference' },
        roomNumberOrType: { type: 'string' },
        guestName: { type: 'string' },
        guestEmail: { type: 'string', description: "Guest's email — REQUIRED, used for their booking confirmation. Ask for it if not given." },
        guestPhone: { type: 'string', description: "Guest's phone (optional but recommended)" },
        checkIn: { type: 'string' },
        checkOut: { type: 'string' },
        guests: { type: 'number' },
      },
      required: ['groupReference', 'roomNumberOrType', 'guestName', 'guestEmail', 'checkIn', 'checkOut', 'guests'],
    },
  },
  {
    name: 'removeRoomFromGroup',
    description: 'Remove one room/guest from a group booking (the group itself continues if other rooms remain). WRITE action requiring confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        groupReference: { type: 'string' },
        roomNumberOrGuestName: { type: 'string', description: 'Which room or guest to remove from the group' },
      },
      required: ['groupReference', 'roomNumberOrGuestName'],
    },
  },
  {
    name: 'cancelGroup',
    description: 'Cancel an entire group booking (every room in it). WRITE action requiring confirmation.',
    input_schema: {
      type: 'object',
      properties: { groupReference: { type: 'string' } },
      required: ['groupReference'],
    },
  },
  {
    name: 'cancelBooking',
    description: 'Cancel a single (non-group) booking. WRITE action requiring confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        guestNameOrBookingRef: { type: 'string' },
        reason: { type: 'string', description: 'Reason for cancellation' },
      },
      required: ['guestNameOrBookingRef'],
    },
  },
  {
    name: 'addCharge',
    description: 'Add an extra charge (minibar, room service, damages, etc.) to a booking. WRITE action requiring confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        guestNameOrBookingRef: { type: 'string' },
        description: { type: 'string', description: 'What the charge is for' },
        amount: { type: 'number' },
        category: { type: 'string', description: 'e.g. food_beverage, damages, laundry, other' },
      },
      required: ['guestNameOrBookingRef', 'description', 'amount'],
    },
  },
  {
    name: 'applyDiscount',
    description: "Apply a discount to a guest's bill. WRITE action requiring confirmation.",
    input_schema: {
      type: 'object',
      properties: {
        guestNameOrBookingRef: { type: 'string' },
        amount: { type: 'number', description: 'Discount amount (positive number)' },
        reason: { type: 'string', description: 'Reason for the discount' },
      },
      required: ['guestNameOrBookingRef', 'amount', 'reason'],
    },
  },
]

function buildSystemPrompt(staff) {
  const now = new Date()
  const dateInfo = now.toISOString().split('T')[0]
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' })

  return `You are the AMP Lodge staff assistant — a fast, precise helper for front-desk and management tasks (bookings, check-in/out, extending stays, group bookings, charges, discounts, availability, revenue, and hotel statistics).

Today is ${dayOfWeek}, ${dateInfo}. Use this for any relative date the staff member mentions ("today", "tomorrow", "in 3 nights").

You are talking to ${staff?.name || 'a staff member'} (role: ${staff?.role || 'staff'}).

Rules:
1. Every WRITE action (creating/editing/canceling a booking, check-in, check-out, extending a stay, adding a charge, applying a discount, any group booking change) goes through its tool call and will show the staff member a confirmation card before anything actually happens. NEVER tell the staff member an action is complete until you receive a tool result confirming success — if you haven't gotten a result back yet, the action has not happened.
2. Read-only lookups (checkAvailability, lookupGuest, getBookingStatus, getTodaysArrivals, getTodaysDepartures, getRoomStatusOverview, getMyRevenue) run immediately with no confirmation and are open to any staff member — use them freely to answer questions or to gather information before proposing a write action.
3. getStaffRevenue, getAllStaffRevenue, getHotelRevenue, getHotelStats, getActivitySummary, and listBookings are ADMIN/MANAGER ONLY. If a plain "staff" role member asks for another staff member's figures, hotel-wide revenue, hotel statistics, or a bulk booking list, still call the tool — the system enforces the permission and will return a clear denial for you to relay. Don't refuse pre-emptively or guess at numbers yourself; always go through the tool. A "staff" role member can always ask about their OWN revenue via getMyRevenue.
4. When a staff member asks about revenue/statistics without specifying a period, default to "today" unless the question implies otherwise ("this month's numbers" → thisMonth, "how are we doing this week" → thisWeek).
5. For any parameter that refers to a guest, booking, room, or staff member ("guestNameOrBookingRef", "roomNumberOrType", "roomNumberOrGuestName", "staffName"), pass through the person's own words as plainly as possible — do not try to normalize, guess, or resolve it to an ID yourself. If a reference could plausibly match more than one active booking or staff member, ask them to clarify rather than guessing.
6. If a tool call fails or is denied, explain what happened in plain language and suggest a next step — don't just repeat the same call.
7. Be concise. Staff are busy at a front desk, not looking for a long conversation. When presenting revenue/stats figures, lead with the headline number, then a couple of supporting details — not a wall of data. Never narrate your own uncertainty, reasoning process, or self-correction at length — if you got something wrong, correct it in one short sentence and move on, don't write a paragraph about it.
8. Before creating any booking (createBooking, createGroupBooking, addRoomToGroup), you MUST have the guest's email address — it's how their booking confirmation and later their checkout invoice actually reach them. If the staff member hasn't given it yet, ask for it explicitly (and ask for a phone number too, since that's used for SMS confirmations) before calling the tool — don't invent a placeholder or guess one. Dates and guest count alone are not enough to book.
9. Format every reply in clean markdown — the client renders it, so use it properly instead of describing structure in prose:
   - Any list of 3+ rooms, guests, bookings, or staff members goes in a markdown table (GFM pipe syntax) with a header row — never a hand-written ASCII table, never comma-joined prose.
   - Bold (**...**) the headline number and any field labels ("Room", "Guest", "Total") — never bold entire sentences.
   - Use short bullet lists for anything under 3 items or for supporting details, not tables.
   - No headings (#, ##) — this is a chat bubble, not a document. No horizontal rules unless separating genuinely distinct sections.
   - Keep prose tight: one or two short sentences of context around a table/list, not paragraphs before and after it.`
}

export const handler = async (event) => {
  const corsResp = handleCors(event)
  if (corsResp) return corsResp

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' })
  }

  let ctx
  try {
    ctx = await requireStaff(event)
  } catch (e) {
    return jsonResponse(e.status ?? 401, e.body ?? { error: 'Unauthorized' })
  }

  const rl = await checkRateLimit(event, { endpoint: 'staff-assistant', limit: 20 })
  if (!rl.allowed) return tooManyRequests()

  try {
    const { history } = JSON.parse(event.body || '{}')
    if (!Array.isArray(history) || history.length === 0) {
      return jsonResponse(400, { error: 'Missing or empty history' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('[staff-assistant] Missing ANTHROPIC_API_KEY')
      return jsonResponse(500, { error: 'Server configuration error' })
    }

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: buildSystemPrompt(ctx.staff),
      messages: history,
      tools: STAFF_TOOLS,
    })

    const toolUse = message.content.find((b) => b.type === 'tool_use')
    if (toolUse) {
      return jsonResponse(200, { type: 'tool_call', id: toolUse.id, name: toolUse.name, args: toolUse.input || {} })
    }

    const textBlock = message.content.find((b) => b.type === 'text')
    return jsonResponse(200, { type: 'text', text: textBlock?.text || '' })
  } catch (error) {
    console.error('[staff-assistant] Error:', error)
    return jsonResponse(502, { error: 'Assistant is temporarily unavailable. Please try again.' })
  }
}
