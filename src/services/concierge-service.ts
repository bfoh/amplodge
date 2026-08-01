// Guest AI Concierge — client-side orchestration.
//
// The LLM call itself goes through netlify/functions/guest-concierge.js (a
// server-side Anthropic proxy — no API key exposed to the browser). Tool
// execution (checking availability, submitting a booking) still happens here
// client-side, calling the same public check-availability/submit-booking
// endpoints the previous Gemini-based version used — no change to those.

import { callFunction } from '@/lib/api'

type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: any }
    | { type: 'tool_result'; tool_use_id: string; content: string }
type ClaudeTurn = { role: 'user' | 'assistant'; content: string | ContentBlock[] }

type AssistantResponse = { type: 'text'; text: string } | { type: 'tool_call'; id: string; name: string; args: any }

// Conversation history
let conversationHistory: ClaudeTurn[] = [];

export const startChatSession = () => {
    conversationHistory = [];
    console.log("[Concierge] Chat session started");
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
const executeToolCall = async (name: string, args: any): Promise<any> => {
    console.log(`[Concierge] Executing tool: ${name}`, args);

    try {
        if (name === "checkRoomAvailability") {
            const { checkIn, checkOut, guests } = args;

            const validation = validateBookingDates(checkIn, checkOut);
            if (!validation.valid) {
                console.warn("[Concierge] Date validation failed:", validation.error);
                return { error: validation.error };
            }

            const response = await fetch(
                `/.netlify/functions/check-availability?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`
            );
            const data = await response.json();
            console.log("[Concierge] Availability result:", data);
            return data;
        }

        if (name === "bookRoom") {
            const { checkIn, checkOut } = args;

            const validation = validateBookingDates(checkIn, checkOut);
            if (!validation.valid) {
                console.warn("[Concierge] Date validation failed:", validation.error);
                return { error: validation.error };
            }

            const response = await fetch("/.netlify/functions/submit-booking", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args)
            });
            const data = await response.json();
            console.log("[Concierge] Booking result:", data);
            return data;
        }

        return { error: "Unknown function" };
    } catch (error) {
        console.error("[Concierge] Tool execution error:", error);
        return { error: "Failed to execute function" };
    }
};

const callConcierge = async (history: ClaudeTurn[]): Promise<AssistantResponse> => {
    const res = await callFunction('guest-concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
        throw new Error(body?.error || `Concierge request failed (${res.status})`)
    }
    return body as AssistantResponse
}

export const sendMessageToConcierge = async (message: string): Promise<string> => {
    try {
        conversationHistory.push({ role: "user", content: message });

        let resp = await callConcierge(conversationHistory);

        // A tool call may chain (rare, but the model could ask for a second
        // tool after seeing the first result) — loop until we get text back.
        while (resp.type === 'tool_call') {
            const { id, name, args } = resp;
            const toolResult = await executeToolCall(name, args);

            conversationHistory.push({ role: 'assistant', content: [{ type: 'tool_use', id, name, input: args }] });
            conversationHistory.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(toolResult) }] });

            resp = await callConcierge(conversationHistory);
        }

        const aiResponse = resp.text || "I couldn't generate a response.";
        conversationHistory.push({ role: "assistant", content: aiResponse });
        return aiResponse;

    } catch (error: any) {
        console.error("[Concierge] Error:", error);
        return "I'm having trouble connecting right now. Please try again.";
    }
};
