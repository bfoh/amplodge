// This environment uses CommonJS
const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const body = JSON.parse(event.body);
        const { currentContent, userPrompt, channel } = body;

        const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.VITE_GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            console.error("Missing Google AI API Key");
            return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error: Missing AI Key" }) };
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        // Construct a focused system prompt
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

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

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
