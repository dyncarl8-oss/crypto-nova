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

  async generateDeepAnalysis(
    symbol: string,
    technicals: TechnicalAnalysis,
    price: number,
    anchorTechnicals?: TechnicalAnalysis,
    news: string[] = []
  ): Promise<DeepAnalysisResult> {
    const prompt = `
      ACT AS: Lead Strategy Architect at a Tier-1 Crypto Hedge Fund.
      OBJECTIVE: Perform an elite-level market analysis for ${symbol}.
      
      MARKET DATA (ENTRY TIMEFRAME):
      Price: $${price}
      RSI: ${technicals.rsi.value} (${technicals.rsi.signal})
      ADX: ${technicals.adx.value.toFixed(1)} (${technicals.adx.signal})
      EMA 12/26/50: ${technicals.ema.ema12.toFixed(2)} / ${technicals.ema.ema26.toFixed(2)} / ${technicals.ema.ema50.toFixed(2)}
      Volume Ratio: ${technicals.volume.ratio.toFixed(2)}x (vVMA20: ${technicals.volume.vma20.toFixed(0)})
      ATR: ${technicals.atr.value.toFixed(2)}
      Regime: ${technicals.summary.regime}
      Patterns Detected: ${technicals.patterns.join(', ') || 'None'}
      
      ${anchorTechnicals ? `
      ANCHOR TIMEFRAME CONTEXT:
      Regime: ${anchorTechnicals.summary.regime}
      Trend (EMA 50): ${anchorTechnicals.ema.trend}
      ` : ''}
      
      LATEST NEWS SENTIMENT:
      ${news.length > 0 ? news.map(n => `- ${n}`).join('\n') : 'No recent headlines.'}
      
      CORE CONSTRAINTS:
      1. RISK FIRST: If Entry Trend (${technicals.ema.trend}) conflicts with Anchor Trend (${anchorTechnicals?.ema.trend || 'N/A'}), be EXTREMELY cautious.
      2. DEAD MARKET: If ADX < 12, force NEUTRAL verdict.
      3. FUEL RULE: If Volume Ratio < 0.8x, label as "Weak Participation".
      4. DECISIVENESS: Look for 3:1 Reward/Risk. If detected, take the trade with 85%+ confidence.
      5. ATR REALISM: Target must be 1.5x - 2.5x ATR. Stop Loss must be 0.8x - 1.3x ATR.
      
      OUTPUT: Return strictly JSON. 
      If direction is NEUTRAL, omit 'targets' and set summary to: "No actionable trade setup detected. Waiting for a higher-confidence entry."
      
      {
        "thought_process": [{ "header": "...", "content": "..." }],
        "observations": ["Bullish/Bearish factor 1", ...],
        "risks": ["Specific risk 1", ...],
        "verdict": {
          "direction": "UP" | "DOWN" | "NEUTRAL",
          "confidence": number,
          "duration": "Intraday/Swing",
          "summary": "Professional concise summary",
          "targets": { "entry": "string", "stopLoss": "string", "target": "string" },
          "riskReward": { "ratio": number, "recommendation": "sizing advice" },
          "marketNarrative": "e.g. Liquidity Sweep / Bull Trap",
          "btcCorrelation": "Contextual note on BTC trend"
        }
      }
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: THINKING_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 4096 }, // Maximize reasoning for perfection
        }
      });

      const text = response.text || "{}";
      const json = JSON.parse(text);

      // Secondary Validation (ATR Enforcement)
      if (json.verdict?.direction !== 'NEUTRAL' && json.verdict?.targets) {
        const atr = technicals.atr.value;
        const entry = parseFloat(json.verdict.targets.entry);
        const target = parseFloat(json.verdict.targets.target);
        const stop = parseFloat(json.verdict.targets.stopLoss);

        // If targets are mathematically unrealistic based on ATR, force Neutral
        const targetDist = Math.abs(target - entry);
        if (targetDist > atr * 4 || targetDist < atr * 0.5) {
          return {
            ...json,
            verdict: {
              ...json.verdict,
              direction: 'NEUTRAL',
              summary: "Suggested targets were mathematically inconsistent with current volatility. Standing aside."
            }
          };
        }
      }

      return json as DeepAnalysisResult;
    } catch (e) {
      console.error("Deep analysis failed", e);
      return {
        thought_process: [{ header: "Error", content: "Analysis pipeline interrupted." }],
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