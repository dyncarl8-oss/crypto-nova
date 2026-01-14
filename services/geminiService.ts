import { GoogleGenAI, Modality } from '@google/genai';
import { THINKING_MODEL, SYSTEM_INSTRUCTION } from '../constants';
import { TechnicalAnalysis, DeepAnalysisResult } from '../types';

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  getLiveClient() {
    return this.ai.live;
  }

  async generateTextResponse(prompt: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        }
      });
      return response.text || "I received your message.";
    } catch (e) {
      console.error("Text generation failed", e);
      return "I am currently unable to process text requests.";
    }
  }

  async generateSpeech(text: string): Promise<string | null> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: { parts: [{ text }] },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    } catch (e) {
      console.error("Speech generation failed", e);
      return null;
    }
  }

  async generateDeepAnalysis(symbol: string, technicals: TechnicalAnalysis, price: number): Promise<DeepAnalysisResult> {
    const prompt = `
      You are Nova, a professional crypto analyst using Gemini 3 Pro. 
      Perform a deep analysis for ${symbol}.
      
      MARKET DATA:
      Price: $${price}
      RSI: ${technicals.rsi.value} (${technicals.rsi.signal})
      Trend: ${technicals.sma.trend}
      Volume Ratio: ${technicals.volume.ratio.toFixed(2)}x
      Regime: ${technicals.summary.regime}
      
      Output strictly in JSON.
      IMPORTANT: Include a 'thought_process' array that breaks down your reasoning steps exactly like a professional internal monologue.
      
      Schema:
      {
        "thought_process": [
           { "header": "Beginning the Prediction Journey", "content": "I'm starting the process of analyzing... identifying current regime..." },
           { "header": "Evaluating Conflicting Signals", "content": "The M30 timeframe shows neutral bias... RSI is ${technicals.rsi.value}..." },
           { "header": "Choosing the Optimal Action", "content": "I'm weighing the trade options..." },
           { "header": "Finalizing Trade Parameters", "content": "Entry is set at..." }
        ],
        "observations": ["string (Key Bullish Factor 1)", "string (Key Bearish Factor 2)"],
        "risks": ["string (Specific Risk 1)", "string (Specific Risk 2)"],
        "verdict": {
          "direction": "UP" | "DOWN" | "NEUTRAL",
          "confidence": number,
          "duration": "string",
          "summary": "string",
          "targets": {
            "entry": "string",
            "stopLoss": "string",
            "target": "string"
          }
        }
      }
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: THINKING_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 1024 },
        }
      });

      const text = response.text || "{}";
      const json = JSON.parse(text);
      return json as DeepAnalysisResult;
    } catch (e) {
      console.error("Deep analysis failed", e);
      return {
        thought_process: [{ header: "Error", content: "Analysis pipeline interrupted."}],
        observations: ["Data analysis incomplete."],
        risks: ["Market volatility"],
        verdict: {
          direction: "NEUTRAL",
          confidence: 0,
          duration: "N/A",
          summary: "Error in analysis pipeline.",
        }
      };
    }
  }
}

export const geminiService = new GeminiService();