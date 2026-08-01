import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'

export const handler = async (event) => {
    const corsResp = handleCors(event); if (corsResp) return corsResp

    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method Not Allowed' });
    }

    try {
        await requireAdmin(event);
    } catch (e) {
        return jsonResponse(e.status, e.body);
    }

    try {
        const body = JSON.parse(event.body);
        const { currentContent, userPrompt, channel } = body;

        const apiKey = process.env.ANTHROPIC_API_KEY;

        if (!apiKey) {
            console.error("Missing Anthropic API Key");
            return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error: Missing AI Key" }) };
        }

        const anthropic = new Anthropic({ apiKey });

        // Construct a focused prompt
        let prompt = `You are an expert hotel marketing copywriter for AMP Lodge (a premium, serene lodge).

Your task: Rewrite or create marketing copy based on the user's instruction.

Channel: ${channel.toUpperCase()} (Keep it ${channel === 'sms' ? 'concise, under 160 chars if possible' : 'engaging and formatted with HTML'}).
Current Content: "${currentContent || ''}"
User Instruction: "${userPrompt}"

Requirements:
- Tone: Professional, Warm, Inviting.
- Maintain placeholders like {{name}} if they exist or are needed.
- IF EMAIL: Return HTML content (divs, p tags, etc) suitable for a newsletter.
- IF SMS: Return plain text.
- Do NOT include markdown code blocks (like \`\`\`html). Just return the raw content.
`;

        const message = await anthropic.messages.create({
            model: "claude-sonnet-5",
            max_tokens: 2048,
            messages: [{ role: "user", content: prompt }],
        });
        const text = message.content.find((b) => b.type === "text")?.text || "";

        // Cleanup: Remove markdown code fences if the AI adds them by mistake
        const cleanText = text.replace(/```html/g, '').replace(/```/g, '').trim();

        return {
            statusCode: 200,
            body: JSON.stringify({ generatedText: cleanText })
        };

    } catch (error) {
        console.error("AI Generation Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate content: " + error.message }) };
    }
};
