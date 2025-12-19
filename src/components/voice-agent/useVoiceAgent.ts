
import { useState, useEffect, useCallback, useRef } from 'react';
import { sendMessageToGemini, startChatSession } from '../../services/gemini-service';

// Define AudioContext type for TypeScript
interface IWindow extends Window {
    webkitAudioContext: typeof AudioContext;
}

export const useVoiceAgent = () => {
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
    const [audioContextReady, setAudioContextReady] = useState(false);

    const recognitionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    // Initialize AudioContext singleton
    const initAudioContext = useCallback(() => {
        if (audioContextRef.current) return;

        const AudioContextClass = window.AudioContext || (window as unknown as IWindow).webkitAudioContext;
        if (AudioContextClass) {
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;
            console.log('[VoiceAgent] AudioContext initialized. State:', ctx.state);
        }
    }, []);

    // Unlock AudioContext - MUST be called from a user gesture (click/touch)
    const unlockAudio = useCallback(async () => {
        initAudioContext();
        const ctx = audioContextRef.current;

        if (!ctx) return;

        if (ctx.state === 'suspended') {
            try {
                await ctx.resume();
                console.log('[VoiceAgent] AudioContext resumed. State:', ctx.state);
            } catch (err) {
                console.error('[VoiceAgent] Failed to resume AudioContext:', err);
            }
        }

        // Play a tiny silent buffer to ensure the audio engine is really "warmed up"
        try {
            const buffer = ctx.createBuffer(1, 1, 22050);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
            setAudioContextReady(true);
            console.log('[VoiceAgent] Audio engine unlocked');
        } catch (e) {
            console.error('[VoiceAgent] Silent buffer unlock failed:', e);
        }
    }, [initAudioContext]);

    // Play synthesized speech using Web Audio API
    const playAudioData = useCallback(async (base64String: string) => {
        initAudioContext();
        const ctx = audioContextRef.current;
        if (!ctx) {
            console.error('[VoiceAgent] No AudioContext available');
            setIsSpeaking(false);
            return;
        }

        try {
            // Ensure context is running (try to resume again just in case)
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            // Convert Base64 to ArrayBuffer
            const binaryString = window.atob(base64String);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const arrayBuffer = bytes.buffer;

            // Decode Audio Data
            // Note: decodeAudioData signature varies, using Promise wrapper or modern Promise return
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            // Stop any currently playing audio
            if (audioSourceRef.current) {
                try {
                    audioSourceRef.current.stop();
                } catch (e) { /* ignore */ }
            }

            // Create Source and Play
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);

            audioSourceRef.current = source;

            source.onended = () => {
                setIsSpeaking(false);
                console.log('[VoiceAgent] Playback ended');
            };

            source.start(0);
            setIsSpeaking(true);
            console.log('[VoiceAgent] Started playback');

        } catch (error) {
            console.error('[VoiceAgent] Playback error:', error);
            setIsSpeaking(false);
        }
    }, [initAudioContext]);

    // Initialize Recognition
    useEffect(() => {
        // @ts-ignore
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.lang = 'en-US';
            recognition.interimResults = false;

            recognition.onstart = () => {
                setIsListening(true);
                // Mic interaction is a gesture - unlock audio!
                unlockAudio();
            };

            recognition.onend = () => setIsListening(false);

            recognition.onresult = async (event: any) => {
                const transcript = event.results[0][0].transcript;
                await handleUserMessage(transcript);
            };

            recognitionRef.current = recognition;
        }

        startChatSession();

        // Try to init context on load (still needs gesture to resume)
        initAudioContext();

        // Cleanup
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    const speak = useCallback(async (text: string) => {
        try {
            console.log('[VoiceAgent] Fetching TTS for:', text);
            setIsSpeaking(true);

            const response = await fetch('/.netlify/functions/text-to-speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (!response.ok) throw new Error('TTS API failed');

            const data = await response.json();
            if (data.audioContent) {
                await playAudioData(data.audioContent);
            } else {
                throw new Error('No audio content');
            }
        } catch (error) {
            console.error('[VoiceAgent] TTS Error:', error);
            setIsSpeaking(false);
        }
    }, [playAudioData]);

    const handleUserMessage = async (text: string) => {
        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsProcessing(true);

        try {
            const aiResponse = await sendMessageToGemini(text);
            setMessages(prev => [...prev, { role: 'ai', text: aiResponse }]);
            await speak(aiResponse);
        } catch (error) {
            console.error('AI Processing Error:', error);
            const errorMsg = "Sorry, I encountered an error.";
            await speak(errorMsg);
            setMessages(prev => [...prev, { role: 'ai', text: errorMsg }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const toggleListening = () => {
        // Stop playback if speaking
        if (isSpeaking && audioSourceRef.current) {
            try {
                audioSourceRef.current.stop();
            } catch (e) { }
            setIsSpeaking(false);
        }

        unlockAudio(); // Important: user gesture here

        if (isListening) {
            recognitionRef.current?.stop();
        } else {
            recognitionRef.current?.start();
        }
    };

    return {
        isListening,
        isProcessing,
        isSpeaking,
        messages,
        toggleListening,
        handleUserMessage,
        unlockAudio // Export for widget
    };
};
