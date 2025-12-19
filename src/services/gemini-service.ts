
// Direct REST API Implementation with Function Calling
// AMP Lodge Voice Agent - Booking System Integration

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = "gemini-2.0-flash-exp";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

// Debug: Expose config to window
// @ts-ignore
window.GEMINI_DEBUG = {
    keySuffix: apiKey ? `...${apiKey.slice(-4)}` : "MISSING",
    model: MODEL,
    deployTimestamp: new Date().toISOString()
};

// Tool Definitions for Booking System
const TOOLS = {
    functionDeclarations: [
        {
            name: "checkRoomAvailability",
            description: "Check hotel room availability for specific dates and number of guests. Call this when the user wants to know what rooms are available.",
            parameters: {
                type: "OBJECT",
                properties: {
                    checkIn: {
                        type: "STRING",
                        description: "Check-in date in YYYY-MM-DD format (e.g., 2024-12-21)"
                    },
                    checkOut: {
                        type: "STRING",
                        description: "Check-out date in YYYY-MM-DD format (e.g., 2024-12-24)"
                    },
                    guests: {
                        type: "NUMBER",
                        description: "Number of guests"
                    }
                },
                required: ["checkIn", "checkOut", "guests"]
            }
        },
        {
            name: "bookRoom",
            description: "Book a hotel room for a guest. Call this after confirming room selection with the user.",
            parameters: {
                type: "OBJECT",
                properties: {
                    checkIn: { type: "STRING", description: "Check-in date in YYYY-MM-DD format" },
                    checkOut: { type: "STRING", description: "Check-out date in YYYY-MM-DD format" },
                    roomTypeId: { type: "STRING", description: "The UUID of the room type to book" },
                    guestName: { type: "STRING", description: "Full name of the guest" },
                    guestEmail: { type: "STRING", description: "Email address of the guest" }
                },
                required: ["checkIn", "checkOut", "roomTypeId", "guestName", "guestEmail"]
            }
        }
    ]
};

// Get current date for system instruction
const getCurrentDateInfo = () => {
    const now = new Date();
    return {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        formatted: now.toISOString().split('T')[0]
    };
};

// System Instruction - includes current date context and comprehensive hotel knowledge
const getSystemInstruction = () => {
    const dateInfo = getCurrentDateInfo();
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
1. Standard Room - Comfortable and affordable, perfect for budget travelers
2. Deluxe Room - More spacious with upgraded amenities
3. Executive Suite - Premium accommodation with extra space and luxury features
4. Family Room - Ideal for families, accommodates more guests

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

Be helpful, friendly, and make guests feel welcome!`;
};

// Conversation history
let conversationHistory: any[] = [];

export const startChatSession = () => {
    conversationHistory = [];
    console.log("[Gemini] Chat session started");
};

// Validate dates before sending to backend
const validateBookingDates = (checkIn: string, checkOut: string): { valid: boolean; error?: string } => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    if (isNaN(checkInDate.getTime())) {
        return { valid: false, error: `Invalid check-in date format: ${checkIn}. Please use YYYY-MM-DD format.` };
    }

    if (isNaN(checkOutDate.getTime())) {
        return { valid: false, error: `Invalid check-out date format: ${checkOut}. Please use YYYY-MM-DD format.` };
    }

    if (checkInDate < today) {
        return { valid: false, error: `Check-in date (${checkIn}) is in the past. Please provide a date from today onwards.` };
    }

    if (checkOutDate <= checkInDate) {
        return { valid: false, error: `Check-out date (${checkOut}) must be after check-in date (${checkIn}).` };
    }

    return { valid: true };
};

// Execute tool calls
const executeToolCall = async (functionCall: any): Promise<any> => {
    const { name, args } = functionCall;
    console.log(`[Gemini] Executing tool: ${name}`, args);

    try {
        if (name === "checkRoomAvailability") {
            const { checkIn, checkOut, guests } = args;

            // Validate dates before making API call
            const validation = validateBookingDates(checkIn, checkOut);
            if (!validation.valid) {
                console.warn("[Gemini] Date validation failed:", validation.error);
                return { error: validation.error };
            }

            const response = await fetch(
                `/.netlify/functions/check-availability?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`
            );
            const data = await response.json();
            console.log("[Gemini] Availability result:", data);
            return data;
        }

        if (name === "bookRoom") {
            const { checkIn, checkOut } = args;

            // Validate dates before making API call
            const validation = validateBookingDates(checkIn, checkOut);
            if (!validation.valid) {
                console.warn("[Gemini] Date validation failed:", validation.error);
                return { error: validation.error };
            }

            const response = await fetch("/.netlify/functions/submit-booking", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args)
            });
            const data = await response.json();
            console.log("[Gemini] Booking result:", data);
            return data;
        }

        return { error: "Unknown function" };
    } catch (error) {
        console.error("[Gemini] Tool execution error:", error);
        return { error: "Failed to execute function" };
    }
};

export const sendMessageToGemini = async (message: string): Promise<string> => {
    try {
        // Add user message to history
        conversationHistory.push({
            role: "user",
            parts: [{ text: message }]
        });

        // Build request body
        const requestBody = {
            contents: conversationHistory,
            systemInstruction: {
                parts: [{ text: getSystemInstruction() }]
            },
            tools: [TOOLS],
            generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.7
            }
        };

        console.log("[Gemini] Sending request...");

        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("[Gemini] API Error:", errorData);
            throw new Error(`API Error ${response.status}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const content = candidate?.content;

        // Check for function calls
        const functionCall = content?.parts?.find((p: any) => p.functionCall);

        if (functionCall) {
            console.log("[Gemini] Function call detected:", functionCall.functionCall);

            // Execute the function
            const toolResult = await executeToolCall(functionCall.functionCall);

            // Add function call to history
            conversationHistory.push({
                role: "model",
                parts: [{ functionCall: functionCall.functionCall }]
            });

            // Add function response to history
            conversationHistory.push({
                role: "user",
                parts: [{
                    functionResponse: {
                        name: functionCall.functionCall.name,
                        response: toolResult
                    }
                }]
            });

            // Get AI's response to the tool result
            const followUpBody = {
                contents: conversationHistory,
                systemInstruction: {
                    parts: [{ text: getSystemInstruction() }]
                },
                tools: [TOOLS],
                generationConfig: {
                    maxOutputTokens: 500,
                    temperature: 0.7
                }
            };

            const followUpResponse = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(followUpBody)
            });

            const followUpData = await followUpResponse.json();
            const aiResponse = followUpData.candidates?.[0]?.content?.parts?.[0]?.text ||
                "I found some options for you! Let me share the details.";

            conversationHistory.push({
                role: "model",
                parts: [{ text: aiResponse }]
            });

            return aiResponse;
        }

        // Regular text response
        const aiResponse = content?.parts?.[0]?.text || "I couldn't generate a response.";

        conversationHistory.push({
            role: "model",
            parts: [{ text: aiResponse }]
        });

        return aiResponse;

    } catch (error: any) {
        console.error("[Gemini] Error:", error);
        return "I'm having trouble connecting right now. Please try again.";
    }
};
