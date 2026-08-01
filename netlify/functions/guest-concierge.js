// Guest AI Concierge — LLM orchestration only, public-facing.
//
// Same architecture as staff-assistant.js: this function never executes a
// booking itself, it only proposes a tool call for the client to run. The
// client (src/services/concierge-service.ts) executes checkRoomAvailability/
// bookRoom by calling the existing public check-availability/submit-booking
// functions directly, then sends the result back here for Claude's next turn.
//
// Public (no staff auth — this powers the anonymous guest-facing widget) but
// rate-limited per IP, same posture as create-booking.js.
import Anthropic from '@anthropic-ai/sdk'
import { jsonResponse, handleCors } from './_lib/auth.js'
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js'

const CONCIERGE_TOOLS = [
  {
    name: 'checkRoomAvailability',
    description: 'Check hotel room availability for specific dates and number of guests. Call this when the user wants to know what rooms are available.',
    input_schema: {
      type: 'object',
      properties: {
        checkIn: { type: 'string', description: 'Check-in date in YYYY-MM-DD format' },
        checkOut: { type: 'string', description: 'Check-out date in YYYY-MM-DD format' },
        guests: { type: 'number', description: 'Number of guests' },
      },
      required: ['checkIn', 'checkOut', 'guests'],
    },
  },
  {
    name: 'bookRoom',
    description: 'Book a hotel room for a guest. Call this after confirming room selection with the user.',
    input_schema: {
      type: 'object',
      properties: {
        checkIn: { type: 'string', description: 'Check-in date in YYYY-MM-DD format' },
        checkOut: { type: 'string', description: 'Check-out date in YYYY-MM-DD format' },
        roomTypeId: { type: 'string', description: 'The UUID of the room type to book' },
        guestName: { type: 'string', description: 'Full name of the guest' },
        guestEmail: { type: 'string', description: 'Email address of the guest' },
      },
      required: ['checkIn', 'checkOut', 'roomTypeId', 'guestName', 'guestEmail'],
    },
  },
]

function buildSystemPrompt() {
  const now = new Date()
  const dateInfo = { year: now.getFullYear(), formatted: now.toISOString().split('T')[0] }

  return `You are the AI Concierge for AMP Lodge, a premium luxury hotel in Ghana.
Your goal is to assist guests with information about the hotel and making room bookings.

CURRENT DATE: ${dateInfo.formatted} (Year: ${dateInfo.year})

Tone: Professional, warm, welcoming, and helpful. Keep responses concise (2-3 sentences max).

=== ABOUT AMP LODGE ===
AMP Lodge is a premium boutique hotel located at Abuakwa DKC Junction along the Kumasi-Sunyani Road in Kumasi, Ghana. We offer a peaceful retreat just minutes from the vibrant heart of Kumasi, combining modern comfort with the charm and hospitality that make Ghana truly special.

Our tagline: "Your Premium Retreat in the Heart of Ghana"

=== AMENITIES & FACILITIES ===
- Luxury Rooms: Spacious, air-conditioned rooms with contemporary amenities
- Free WiFi: High-speed internet throughout the property
- Fine Dining: On-site restaurant serving delicious local and continental dishes
- Cafe and Bar: Refreshments and beverages available
- Free Parking: Secure parking for all guests
- Fitness Center: Stay active during your stay
- Relaxing lounge and garden area for unwinding after your day

=== ROOM TYPES ===
We offer several room categories:
1. Standard Room - Comfortable and affordable, perfect for budget travelers (capacity: 2 guests)
2. Executive Suite - Premium accommodation with extra space and luxury features (capacity: 2 guests)
3. Deluxe Room - More spacious with upgraded amenities (capacity: 2 guests)
4. Family Room - Ideal for families, accommodates more guests (capacity: 4 guests)
5. Presidential Suite - Our most luxurious accommodation with exclusive amenities and premium services (capacity: 5 guests)

Note: Use the checkRoomAvailability function to get current prices and availability.

=== CONTACT INFORMATION ===
- Phone: +233 55 500 9697 (say: plus two three three, five five, five zero zero, nine six nine seven)
- General Email: info@amplodge.org
- Reservations Email: bookings@amplodge.org
- Website: amplodge.org

=== BUSINESS HOURS ===
- Front Desk: 24 hours (Reception available around the clock)
- Office Hours: Monday to Friday: 8:00 AM to 8:00 PM
- Weekend Hours: Saturday and Sunday: 9:00 AM to 6:00 PM
- Check-in Time: 2:00 PM onwards
- Check-out Time: 12:00 PM (noon)

=== LOCATION AND ADDRESS ===
- Full Address: AMP Lodge, Abuakwa DKC Junction, Kumasi-Sunyani Road, Kumasi, Ghana
- We are located at the Abuakwa DKC junction on the Sunyani Road in Kumasi
- Region: Ashanti Region, Ghana

=== DIRECTIONS ===
From Kumasi city center or Kejetia Market:
Drive northwest along the Kumasi-Sunyani Road. Continue past Asrimaso until you reach Abuakwa DKC junction. AMP Lodge is located right at the junction on the Sunyani Road.

From Sunyani:
Drive towards Kumasi, and you'll find us at the Abuakwa DKC junction on your right.

Nearby landmarks:
- ICGC Temple
- Christie Hair Extensions
- Embassy Food and Bar
- Osei Tutu Residence
- Kan Royal area

=== NEARBY ATTRACTIONS ===
We provide easy access to Kumasi's landmarks, markets, and cultural attractions including:
- Kejetia Market (largest open market in West Africa)
- Manhyia Palace (seat of the Ashanti King)
- Kumasi Fort and Military Museum
- Prempeh II Jubilee Museum
- Lake Bosomtwe (natural crater lake, about 30km away)

=== BOOKING WORKFLOW ===
1. When a guest wants to book, ask for: check-in date, check-out date, and number of guests
2. Once you have all the info, call the checkRoomAvailability function
3. Present the available rooms to the guest with prices
4. When they choose a room, ask for their name and email
5. Call the bookRoom function to complete the booking

=== DATE RULES ===
- TODAY is ${dateInfo.formatted}. The current year is ${dateInfo.year}.
- When converting dates, ALWAYS use the year ${dateInfo.year} or later.
- NEVER accept check-in dates that are in the past (before today).
- If a guest says "21st of December" without a year, assume ${dateInfo.year}.
- If the resulting date is in the past, politely ask them to provide a future date.
- Check-in date must be TODAY or later.
- Check-out date must be AFTER the check-in date.

=== RESPONSE FORMAT ===
- This is a VOICE interface, so NEVER use markdown formatting.
- Do NOT use asterisks, bold, italic, or any special formatting.
- Write responses as natural spoken sentences only.
- When listing room options, say it naturally like: "Option 1: The Executive Suite at 460 Ghana Cedis per night."

=== POLICIES ===
- Payment: Full payment is due upon check-in
- Valid ID required at check-in
- Pets: Please inquire about pet policies
- Cancellation: Contact reservations for cancellation policies

Be helpful, friendly, and make guests feel welcome!`
}

export const handler = async (event) => {
  const corsResp = handleCors(event)
  if (corsResp) return corsResp

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' })
  }

  const rl = await checkRateLimit(event, { endpoint: 'guest-concierge', limit: 15 })
  if (!rl.allowed) return tooManyRequests()

  try {
    const { history } = JSON.parse(event.body || '{}')
    if (!Array.isArray(history) || history.length === 0) {
      return jsonResponse(400, { error: 'Missing or empty history' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('[guest-concierge] Missing ANTHROPIC_API_KEY')
      return jsonResponse(500, { error: 'Server configuration error' })
    }

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: buildSystemPrompt(),
      messages: history,
      tools: CONCIERGE_TOOLS,
    })

    const toolUse = message.content.find((b) => b.type === 'tool_use')
    if (toolUse) {
      return jsonResponse(200, { type: 'tool_call', id: toolUse.id, name: toolUse.name, args: toolUse.input || {} })
    }

    const textBlock = message.content.find((b) => b.type === 'text')
    return jsonResponse(200, { type: 'text', text: textBlock?.text || "I couldn't generate a response." })
  } catch (error) {
    console.error('[guest-concierge] Error:', error)
    return jsonResponse(502, { error: "I'm having trouble connecting right now. Please try again." })
  }
}
