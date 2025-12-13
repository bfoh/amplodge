import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@blinkdotnew/sdk";

// Configure CORS headers once
const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Initialize Blink SDK client for this project
const blink = createClient({
  projectId: "amp-lodge-hotel-management-system-j2674r7k",
  auth: { mode: "managed" },
});

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init?.headers || {}),
    },
  });
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 });
}

function unauthorized(message = "Missing or invalid Authorization header") {
  return json({ error: message }, { status: 401 });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathname = url.pathname.replace(/\/$/, ""); // trim trailing slash

  // Health check (no auth required)
  if (req.method === "GET" && (pathname.endsWith("/health") || pathname.endsWith("/"))) {
    return json({ ok: true, name: "AMP Lodge Booking Engine", version: 1 });
  }

  // For DB operations, require Blink JWT from Authorization header
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!jwt) {
    return unauthorized();
  }
  blink.auth.setToken(jwt);

  // GET /bookings - list bookings with optional filters
  if (req.method === "GET" && pathname.endsWith("/bookings")) {
    try {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const status = url.searchParams.get("status");
      const roomId = url.searchParams.get("roomId");

      // Build where filter (camelCase → snake_case handled by SDK)
      const where: any = {};
      if (status) where.status = status;
      if (roomId) where.roomId = roomId;

      // Date range filter
      if (from && to) {
        where.AND = [
          { checkIn: { lte: to } },
          { checkOut: { gte: from } },
        ];
      } else if (from) {
        where.checkOut = { gte: from };
      } else if (to) {
        where.checkIn = { lte: to };
      }

      const bookings = await blink.db.bookings.list({
        where,
        orderBy: { createdAt: "desc" },
        limit: 200,
      });

      return json({ bookings });
    } catch (error: any) {
      return json({ error: error?.message || "Failed to list bookings" }, { status: 500 });
    }
  }

  // POST /bookings - create a booking
  if (req.method === "POST" && pathname.endsWith("/bookings")) {
    try {
      const body = await req.json();
      console.log('[BookingAPI] Received booking request:', JSON.stringify(body, null, 2));
      
      // Accept either an existing guestId or guest info to upsert
      const {
        guestId: providedGuestId,
        guest, // { name, email, phone, address }
        roomId,
        checkIn,
        checkOut,
        totalPrice,
        numGuests = 1,
        specialRequests = "",
        status = "confirmed",
      } = body || {};

      if (!roomId || !checkIn || !checkOut || (!providedGuestId && !guest)) {
        console.error('[BookingAPI] Missing required fields');
        return badRequest("roomId, checkIn, checkOut and guest/guestId are required");
      }

      let guestId = providedGuestId as string | undefined;
      const email = (guest?.email || "").trim().toLowerCase();
      const guestName = (guest?.name || "Guest").trim();
      
      console.log('[BookingAPI] Resolving guest - email:', email, 'name:', guestName);
      
      if (!guestId && guest) {
        // Try to find existing guest by email
        if (email) {
          try {
            const existing = await blink.db.guests.list({ where: { email }, limit: 1 });
            if (existing?.[0]) {
              guestId = existing[0].id;
              console.log('[BookingAPI] Found existing guest by email:', guestId);
            }
          } catch (findErr: any) {
            console.warn('[BookingAPI] Error finding guest by email:', findErr?.message);
          }
        }
        
        // If not found, create new guest
        if (!guestId) {
          const base = (email || guestName || "guest").toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
          const id = `guest-${base}`;
          const fallbackEmail = email || `${id}@guest.local`;
          
          console.log('[BookingAPI] Creating guest with ID:', id);
          
          try {
            const created = await blink.db.guests.create({
              id,
              name: guestName,
              email: fallbackEmail,
              phone: guest?.phone || "",
              address: guest?.address || "",
            });
            guestId = id;
            console.log('[BookingAPI] Guest created:', guestId, created);
          } catch (createErr: any) {
            const msg = createErr?.message || "";
            const errStatus = createErr?.status;
            console.warn('[BookingAPI] Guest creation failed:', errStatus, msg);
            
            // If constraint violation, guest probably exists
            if (errStatus === 409 || msg.includes("Constraint violation") || msg.includes("UNIQUE")) {
              guestId = id;
              console.log('[BookingAPI] Guest exists (constraint), using ID:', guestId);
            } else {
              // For other errors, try a timestamped fallback
              const timestamp = Date.now();
              const random = Math.random().toString(36).slice(2, 6);
              const fallbackId = `guest-${timestamp}-${random}`;
              
              console.log('[BookingAPI] Trying fallback guest ID:', fallbackId);
              
              try {
                await blink.db.guests.create({
                  id: fallbackId,
                  userId: (await blink.auth.me().catch(() => null))?.id || null,
                  name: guestName,
                  email: fallbackEmail,
                  phone: guest?.phone || "",
                  address: guest?.address || "",
                });
                guestId = fallbackId;
                console.log('[BookingAPI] Fallback guest created:', guestId);
              } catch (fallbackErr: any) {
                console.error('[BookingAPI] Fallback guest creation failed:', fallbackErr?.message);
                guestId = fallbackId; // Use anyway as last resort
              }
            }
          }
        }
      }

      if (!guestId) {
        console.error('[BookingAPI] Failed to resolve guestId');
        return badRequest("Unable to resolve guestId");
      }

      console.log('[BookingAPI] Final guestId:', guestId, 'Creating booking...');

      const currentUser = await blink.auth.me().catch(() => null)
      const booking = await blink.db.bookings.create({
        userId: currentUser?.id || null,
        guestId,
        roomId,
        checkIn,
        checkOut,
        status,
        totalPrice: totalPrice ?? 0,
        numGuests,
        specialRequests,
      });

      console.log('[BookingAPI] Booking created successfully:', booking);
      return json({ booking }, { status: 201 });
    } catch (error: any) {
      console.error('[BookingAPI] Booking creation failed:', error?.message, error?.stack);
      return json({ error: error?.message || "Failed to create booking" }, { status: 500 });
    }
  }

  return json({ error: "Not Found" }, { status: 404 });
});
