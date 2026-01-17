import React, { useState, useEffect, useRef } from 'react';
import { Mic, Send, Menu, MicOff, Terminal, Wifi, X, Power, Settings, Check, PhoneOff, Phone, ChevronRight, ChevronLeft, Zap } from 'lucide-react';
import VoiceOrb from './components/VoiceOrb';
import AnalysisDashboard from './components/AnalysisDashboard';
import TypewriterHint from './components/TypewriterHint';
import MembershipGate from './components/MembershipGate';
import { MarketState, ChatMessage, CRYPTO_TOOLS, AnalysisStage } from './types';
import { geminiService } from './services/geminiService';
import { fetchOHLCV, fetchCurrentPrice, analyzeMarket } from './services/marketService';
import { LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from './services/audioUtils';
import { SYSTEM_INSTRUCTION, LIVE_MODEL } from './constants';
import { whopService } from './services/whopService';
import { WhopUser, WhopAccess } from './types';
import { serverLog } from './services/logger';
import clsx from 'clsx';
import { WhopCheckoutEmbed } from "@whop/checkout/react";

export default function App() {
  // --- STATE ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [marketState, setMarketState] = useState<MarketState | null>(null);
  const [orbState, setOrbState] = useState<'listening' | 'speaking' | 'thinking' | 'idle'>('idle');
  const [volume, setVolume] = useState(0);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(true);
  const [isSystemBusy, setIsSystemBusy] = useState(false);
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [whopUser, setWhopUser] = useState<WhopUser | null>(null);
  const [whopAccess, setWhopAccess] = useState<WhopAccess | null>(null);
  const [isWhopLoading, setIsWhopLoading] = useState(true);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  // --- SETTINGS STATE ---
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);

  // --- REFS ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null); // Live Session
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentModelResponseRef = useRef<string>(''); // Accumulate voice transcription

  // Synchronization Ref: Holds the resolve function for the visual animation promise
  const visualCompleteResolverRef = useRef<(() => void) | null>(null);
  const orbStateRef = useRef(orbState);
  const isSessionReadyRef = useRef(false);
  const isAnalysisRunningRef = useRef(false);

  // Sync ref with state
  useEffect(() => {
    orbStateRef.current = orbState;
  }, [orbState]);

  // --- HELPERS ---
  const addMessage = (role: 'user' | 'ai', text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setMessages(prev => [...prev, { id, role, text, timestamp: Date.now() }]);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => scrollToBottom(), [messages]);

  // --- INTERLOCK RELEASE ---
  useEffect(() => {
    // If analysis is complete and Nova has finished speaking (returned to listening or idle)
    if (marketState?.stage === AnalysisStage.COMPLETE &&
      (orbState === 'listening' || orbState === 'idle') &&
      isSystemBusy) {
      setIsSystemBusy(false);

      // Automatically restore mic if it was active before
      if (isMicActive) {
        setIsMuted(false);
        if (streamRef.current) {
          const track = streamRef.current.getAudioTracks()[0];
          if (track) track.enabled = true;
        }
      }
    }
  }, [marketState?.stage, orbState, isSystemBusy, isMicActive]);

  // --- DEVICE ENUMERATION ---
  useEffect(() => {
    const getDevices = async () => {
      try {
        // We need to ask for permission briefly to get labels, but we can try without first
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        setAudioDevices(audioInputs);

        // Auto-select first device if none selected
        if (audioInputs.length > 0 && !selectedDeviceId) {
          // Prefer default if it exists
          const defaultDevice = audioInputs.find(d => d.deviceId === 'default');
          setSelectedDeviceId(defaultDevice ? defaultDevice.deviceId : audioInputs[0].deviceId);
        }
      } catch (e) {
        console.error("Error fetching devices", e);
      }
    };

    getDevices();
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', getDevices);
  }, [selectedDeviceId]);

  useEffect(() => {
    const authenticateWhop = async () => {
      console.log("-----------------------------------------");
      console.log("PROTOCOL: INITIALIZING WHOP AUTHENTICATION");
      setIsWhopLoading(true);

      try {
        // Fetch user data from our server which can read the x-whop-user-token header
        const response = await fetch('/api/whop/me');
        const data = await response.json();

        console.log("[WHOP AUTH] Server response:", data);

        if (data.authenticated && data.user) {
          setWhopUser(data.user);
          setWhopAccess(data.access);
          console.log("[WHOP AUTH] User authenticated:", data.user.name);
        } else {
          console.log("[WHOP AUTH] Not authenticated:", data.error || 'Unknown reason');
          // Guest mode - allow access without profile display
        }
      } catch (error) {
        console.error("[WHOP AUTH] Error fetching user:", error);
        // Guest mode on error
      }

      setIsWhopLoading(false);
    };

    authenticateWhop();
  }, []);

  // --- AUDIO OUTPUT HELPER ---
  const playAudioData = async (base64Data: string, onStart?: () => void) => {
    return new Promise<void>(async (resolve) => {
      let timeout: any;
      try {
        setOrbState('speaking');
        setVolume(0.8);

        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;

        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // Safety timeout to prevent hanging the chat flow
        timeout = setTimeout(() => {
          console.warn("Audio playback timeout reached (60s).");
          resolve();
        }, 60000);

        const buffer = await decodeAudioData(base64ToUint8Array(base64Data), ctx, 24000);
        console.log(`Audio: Decoding complete. Duration: ${buffer.duration.toFixed(1)}s`);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        // Ensure playback starts in the future relative to the context
        const playTime = Math.max(nextStartTimeRef.current, ctx.currentTime);

        // --- SYNC POINT: Trigger callback exactly before start ---
        if (onStart) onStart();

        source.start(playTime);
        nextStartTimeRef.current = playTime + buffer.duration;

        source.onended = () => {
          clearTimeout(timeout);
          if (ctx.currentTime >= nextStartTimeRef.current - 0.1) {
            setOrbState(isMicActive ? 'listening' : 'idle');
            setVolume(0);
          }
          resolve();
        };
      } catch (err) {
        if (timeout) clearTimeout(timeout);
        console.error("Audio playback error:", err);
        setOrbState(isMicActive ? 'listening' : 'idle');
        resolve(); // Resolve anyway to unblock the UI
      }
    });
  };

  const speak = async (text: string, onStart?: () => void) => {
    try {
      const audioData = await geminiService.generateSpeech(text);
      if (audioData) {
        return await playAudioData(audioData, onStart);
      }
    } catch (err) {
      console.error("Speech generation error:", err);
    }
  };

  // --- TIMED ANALYSIS FLOW ---
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const handleMarketAnalysis = async (symbol: string) => {
    try {
      // Initialize State
      setMarketState({
        symbol: symbol.toUpperCase(),
        status: 'FETCHING',
        stage: AnalysisStage.FETCHING_DATA,
        timings: { data: 0, technicals: 0, aggregation: 0, ai: 0 },
        price: 0, change24h: 0, volume24h: 0, dataPoints: 0,
        candles: [], news: [], systemLog: [`[${new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}] > INITIALIZING GLASS BOX DIAGNOSTICS...`],
        technicals: null, anchorTechnicals: null, deepAnalysis: null
      });

      const log = (msg: string) => {
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setMarketState(prev => prev ? { ...prev, systemLog: [...prev.systemLog, `[${time}] > ${msg}`] } : null);
      };

      // Step 1: Data Collection
      log(`CONNECTING TO EXCHANGE: FETCHING ${symbol.toUpperCase()} STREAMS...`);
      const t0 = performance.now();

      const { fetchNews } = await import('./services/marketService');

      const [priceData, ohlcvData, anchorData, news] = await Promise.all([
        fetchCurrentPrice(symbol),
        fetchOHLCV(symbol, 300, 'hour'),
        fetchOHLCV(symbol, 100, 'day'),
        fetchNews(symbol)
      ]);

      log(`DATA RECEIVED: 1H STREAMS INGESTED. DAILY ANCHOR SYNCED.`);
      log(`NEWS INGESTION: ${news.length} HEADLINES QUEUED FOR SENTIMENT AUDIT.`);
      const candles = ohlcvData.candles;
      const anchorCandles = anchorData.candles;

      if (!candles || candles.length === 0) {
        throw new Error(`Market data for ${symbol} is currently empty or unavailable.`);
      }

      // STABILIZATION: Update all primary data fields BEFORE moving stage
      setMarketState(prev => ({
        ...prev!,
        symbol: priceData.pair,
        price: priceData.price,
        change24h: priceData.change24h,
        volume24h: candles[candles.length - 1].volume,
        candles,
        news,
        dataPoints: candles.length
      }));

      await delay(1500);
      log("DATA FEED STABILIZED. TRANSITIONING TO PROTOCOL EXECUTION...");
      setMarketState(prev => ({ ...prev!, stage: AnalysisStage.PROTOCOL_LOGS }));
      await delay(1500);

      const t1 = performance.now();

      setMarketState(prev => ({
        ...prev!,
        stage: AnalysisStage.COMPUTING_TECHNICALS,
        timings: { ...prev!.timings, data: parseFloat(((t1 - t0) / 1000).toFixed(1)) },
      }));

      // Step 2: Technicals
      log("COMPUTING MULTI-LAYER TECHNICAL INDICATORS...");
      const t2_start = performance.now();
      const technicals = analyzeMarket(candles);

      log("SYNCHRONIZING WITH ANCHOR TIMEFRAME (1D)...");
      const anchorTechnicals = analyzeMarket(anchorCandles);

      log(`ADX(${technicals.adx.value.toFixed(1)}) | ATR(${technicals.atr.value.toFixed(4)}) | RSI(${(technicals.rsi.value as number).toFixed(1)})`);
      log(`ANCHOR TREND: ${anchorTechnicals.sma.trend} | ENTRY TREND: ${technicals.sma.trend}`);

      const t2_end = performance.now();

      setMarketState(prev => ({
        ...prev!,
        stage: AnalysisStage.SAFETY_AUDIT,
        timings: { ...prev!.timings, technicals: parseFloat(((t2_end - t2_start) / 1000).toFixed(1)) },
        technicals,
        anchorTechnicals
      }));

      await delay(2000);
      log("SAFETY AUDIT COMPLETE. COMMENCING SENTIMENT ANALYSIS...");
      setMarketState(prev => ({ ...prev!, stage: AnalysisStage.SENTIMENT_AUDIT }));
      await delay(2000);

      setMarketState(prev => ({
        ...prev!,
        stage: AnalysisStage.AGGREGATING_SIGNALS,
      }));

      // Step 3: Signal Aggregation
      log("AGGREGATING SIGNALS: CALCULATING CONVICTION SCORE...");
      await delay(2000); // 2s delay to "weigh signals"
      const t3 = performance.now();

      setMarketState(prev => ({
        ...prev!,
        stage: AnalysisStage.GENERATING_THOUGHTS,
        timings: { ...prev!.timings, aggregation: parseFloat(((t3 - t2_end) / 1000).toFixed(1)) },
      }));

      // Step 4: AI Deep Analysis (Async)
      log("INITIALIZING GEMINI-3-PRO: EXECUTING STRATEGIC REASONING...");
      const t4_start = performance.now();
      const deepAnalysis = await geminiService.generateDeepAnalysis(
        symbol,
        technicals,
        priceData.price,
        anchorTechnicals,
        news
      );

      const t4_end = performance.now();
      const aiTime = parseFloat(((t4_end - t4_start) / 1000).toFixed(1));

      log("REASONING COMPLETE. APPLYING ATR VOLATILITY GUARD...");
      if (deepAnalysis.verdict.direction !== 'NEUTRAL' && deepAnalysis.verdict.targets) {
        log(`TARGET AUDIT: ${deepAnalysis.verdict.targets.target} | ATR LIMITS: VALID`);
      }

      setMarketState(prev => ({
        ...prev!,
        deepAnalysis,
        timings: { ...prev!.timings, ai: aiTime },
        stage: AnalysisStage.COMPLETE // Explicitly mark complete here for the log
      }));

      // --- SAVE TO DATABASE ---
      if (deepAnalysis) {
        try {
          await fetch('/api/analysis/save', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Note: The header 'x-whop-user-token' is automatically handled by the Whop proxy or should be present if in cookie 
            },
            body: JSON.stringify({
              symbol: symbol.toUpperCase(),
              price: priceData.price,
              verdict: deepAnalysis.verdict,
              technicals: technicals,
              thought_process: deepAnalysis.thought_process
            })
          });
          log("ANALYSIS PERSISTED TO SECURE DATABASE.");
        } catch (saveErr) {
          console.error("Failed to save analysis history:", saveErr);
          log("WARNING: FAILED TO PERSIST ANALYSIS DATA.");
        }
      }

      log("ANALYSIS PROTOCOL FINALIZED. READY FOR DISSEMINATION.");

      // SYNCHRONIZATION:
      // We pause the execution here until the UI calls handleAnalysisVisualComplete.
      // This ensures we do not send the tool response (which triggers voice) until the visuals are done.
      await new Promise<void>((resolve) => {
        visualCompleteResolverRef.current = resolve;
        // Fallback safety: If UI doesn't resolve in 45s, proceed anyway
        setTimeout(() => {
          if (visualCompleteResolverRef.current === resolve) {
            console.warn("Visual sync timed out, forcing proceed");
            resolve();
          }
        }, 45000);
      });

      // Return richer data for the AI to speak about
      return {
        price: priceData.price,
        change24h: priceData.change24h,
        rsi: technicals.rsi.value,
        trend: technicals.sma.trend,
        verdict: deepAnalysis.verdict.direction,
        summary: deepAnalysis.verdict.summary, // Pass the text summary so Live model can read it!
        confidence: deepAnalysis.verdict.confidence
      };

    } catch (e: any) {
      console.error("handleMarketAnalysis CRITICAL ERROR:", e);
      setMarketState(prev => {
        if (!prev) return null;
        return { ...prev, stage: AnalysisStage.ERROR };
      });
      return {
        error: "Failed to fetch market data. " + e.message,
        verdict: "Error",
        summary: "I encountered a technical error while accessing market data. Please check the system log for details."
      };
    }
  };

  const handleAnalysisVisualComplete = () => {
    // 1. Resolve the backend promise to unblock the Voice/Tool response
    if (visualCompleteResolverRef.current) {
      visualCompleteResolverRef.current();
      visualCompleteResolverRef.current = null;
    }

    // 2. Update UI state to show final verdict
    setMarketState(prev => {
      if (!prev) return null;
      if (prev.stage === AnalysisStage.COMPLETE) return prev;
      return { ...prev, stage: AnalysisStage.COMPLETE };
    });
  };

  // --- LIVE API SETUP ---
  const connectLive = async () => {
    try {
      const client = geminiService.getLiveClient();

      const session = await client.connect({
        model: LIVE_MODEL,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          tools: [{ functionDeclarations: CRYPTO_TOOLS }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log("Connected to Gemini Live");
            isSessionReadyRef.current = true;
            setOrbState('listening');
            setError(null);
            currentModelResponseRef.current = '';
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Audio Output
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              // NON-BLOCKING: We don't await here so the stream can keep processing
              playAudioData(audioData);
            }

            // Transcript handling (Input/Output)
            const inputTrans = msg.serverContent?.inputTranscription;
            if (inputTrans?.text && (inputTrans as any).final) {
              addMessage('user', inputTrans.text);
            }

            const modelTranscript = msg.serverContent?.outputTranscription?.text;
            if (modelTranscript) currentModelResponseRef.current += modelTranscript;

            if (msg.serverContent?.turnComplete) {
              if (currentModelResponseRef.current.trim()) {
                addMessage('ai', currentModelResponseRef.current.trim());
                currentModelResponseRef.current = '';
              }
            }

            // Tool Calls
            if (msg.toolCall) {
              setOrbState('thinking');
              const functionCalls = msg.toolCall.functionCalls;
              const responses = [];
              for (const call of functionCalls) {
                if (call.name === 'analyze_market') {
                  const { symbol } = call.args as any;

                  if (isAnalysisRunningRef.current) {
                    console.warn("ToolCall: Analysis already in progress, skipping duplicative call.");
                    continue;
                  }

                  // 0. CREDIT CHECK (Tool Call)
                  // Note: This duplicates logic but necessary to catch Tool calls triggered by Voice directly if possible.
                  // Since handleTextSubmit handles text, this handles voice tool calls.
                  if (!whopUser?.isUnlimited && (whopUser?.credits ?? 0) <= 0) {
                    addMessage('ai', "Insufficient credits for analysis.");
                    await speak("I'm sorry, you have insufficient credits. Please upgrade your plan.");

                    if (isSessionReadyRef.current) {
                      session.sendToolResponse({
                        functionResponses: [{
                          id: call.id,
                          name: call.name,
                          response: { result: { error: "Insufficient credits" } }
                        }]
                      });
                    }
                    continue;
                  }

                  // If credits exist, we attempt deduction asynchronously or we trust the flow? 
                  // Ideally we deduct here too.
                  if (!whopUser?.isUnlimited) {
                    await fetch('/api/credits/deduct', { method: 'POST' });
                    // Optimistic update
                    setWhopUser(prev => prev ? ({ ...prev, credits: Math.max(0, (prev.credits ?? 0) - 1) }) : null);
                  }

                  // 1. INTERLOCK ACTIVATE
                  setIsSystemBusy(true);
                  setIsMuted(true);
                  if (streamRef.current) {
                    const track = streamRef.current.getAudioTracks()[0];
                    if (track) track.enabled = false;
                  }

                  // 2. VISUAL & AUDIO ACKNOWLEDGEMENT (IMMEDIATE)
                  addMessage('ai', `Analysis Protocol Initiated: ${symbol}`);

                  // Speak immediately to confirm receipt while the long process starts
                  await speak(`Acknowledged. Accessing decentralized market feeds for ${symbol}. Initiating quantum analysis protocol. Please stand by.`);

                  // 2. RUN ANALYSIS (Waits for visual completion)
                  isAnalysisRunningRef.current = true;
                  try {
                    const result = await handleMarketAnalysis(symbol);

                    // 3. SEND RESULT (Only after visuals are done)
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { result }
                    });
                  } finally {
                    isAnalysisRunningRef.current = false;
                  }
                }
              }
              if (isSessionReadyRef.current) {
                session.sendToolResponse({ functionResponses: responses });
              } else {
                console.warn("Skipping ToolResponse: Session not ready.");
              }
            }
          },
          onclose: (event) => {
            console.warn("Gemini Live session closed:", event);
            isSessionReadyRef.current = false;
            setOrbState('idle');
            setIsMicActive(false);
          },
          onerror: (e) => {
            console.error("Gemini Live session error:", e);
            isSessionReadyRef.current = false;
            setError("Session Error: " + (e.message || "Unknown error"));
            setOrbState('idle');
            setIsMicActive(false);
          }
        }
      });

      sessionRef.current = session;
      return session;

    } catch (e: any) {
      console.error(e);
      setError("Failed to connect: " + e.message);
      setIsMicActive(false);
    }
  };


  const cleanupAudioResources = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
        audioContextRef.current = null;
      }
    } catch (e) {
      console.error("Audio cleanup error:", e);
    }
  };

  const startAudioStream = async (deviceId?: string) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        sampleRate: 16000,
        channelCount: 1
      }
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!sessionRef.current || !isSessionReadyRef.current) return;

      const inputData = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
      const rms = Math.sqrt(sum / inputData.length);
      setVolume(Math.min(1, rms * 5));

      if (orbStateRef.current === 'listening' || orbStateRef.current === 'idle') {
        try {
          const pcmBlob = createPcmBlob(inputData, 16000);
          sessionRef.current.sendRealtimeInput({ media: pcmBlob });
        } catch (err) {
          console.warn("Realtime input send failed:", err);
        }
      }
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    sourceRef.current = source;
    scriptProcessorRef.current = processor;
  };

  const startMic = async () => {
    if (isMicActive) return;
    setError(null);
    setIsMuted(false);

    try {
      await startAudioStream(selectedDeviceId);

      const session = await connectLive();
      if (!session) {
        throw new Error("Core session failed to initialize. Please check your connection.");
      }

      setIsMicActive(true);
      setIsMuted(false);

    } catch (e: any) {
      console.error("CRITICAL CONNECTION FAILURE:", e);
      setError("System failed to initialize: " + (e.message || "Unknown error"));
      setIsMicActive(false);
      cleanupAudioResources();
    }
  };

  const stopMic = () => {
    cleanupAudioResources();

    if (sessionRef.current) {
      isSessionReadyRef.current = false;
      sessionRef.current.close();
      sessionRef.current = null;
    }

    // FULL SESSION RESET
    setIsMicActive(false);
    setOrbState('idle');
    setIsMuted(false);
    setMarketState(null);
    setMessages([]);
    setIsSystemBusy(false);
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const track = streamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      }
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText.trim();
    setInputText('');

    // 1. STRICTOR CREDIT CHECK (Unified)
    // Check at the very beginning before even adding the user message to the log or speaking
    if (!whopUser?.isUnlimited && (whopUser?.credits ?? 0) <= 0) {
      await speak("Insufficient credits. Please upgrade your plan for unlimited access.");
      return;
    }

    addMessage('user', text);
    setIsChatThinking(true);

    const analyzeMatch = text.match(/(?:analyze|check|show|price|what\s+is)\s+(?:(?:the|price|of|a)\s+)*([a-z0-9]{2,})/i);

    if (analyzeMatch) {
      if (isAnalysisRunningRef.current) {
        console.warn("Terminal: Analysis already in progress, skipping.");
        setIsChatThinking(false);
        return;
      }

      const symbol = analyzeMatch[1].toUpperCase();
      console.log("Terminal: Initiating analysis for", symbol);

      // 1. UNIFIED STATE & INTERLOCK
      setOrbState('thinking');
      setIsSystemBusy(true);
      setIsMuted(true);
      if (streamRef.current) {
        const track = streamRef.current.getAudioTracks()[0];
        if (track) track.enabled = false;
      }

      // 2. CREDIT DEDUCTION (Internal)
      if (!whopUser?.isUnlimited) {
        try {
          const deductRes = await fetch('/api/credits/deduct', { method: 'POST' });
          const deductData = await deductRes.json();
          if (deductData.success || deductData.isUnlimited) {
            setWhopUser(prev => prev ? ({ ...prev, credits: deductData.remaining === 'UNLIMITED' ? undefined : deductData.remaining }) : null);
          } else {
            await speak("Insufficient credits. Please upgrade your plan.");
            addMessage('ai', "Insufficient credits. Please upgrade to continue.");
            setIsChatThinking(false);
            setOrbState('idle');
            setIsSystemBusy(false);
            return;
          }
        } catch (e) {
          console.error("Credit deduction failed", e);
        }
      }

      // 3. UNIFIED CINEMATIC ACKNOWLEDGEMENT (Only after deduction succeeds)
      addMessage('ai', `Analysis Protocol Initiated: ${symbol}`);

      setTimeout(async () => {
        try {
          await speak(
            `Acknowledged. Accessing decentralized market feeds for ${symbol}. Initiating quantum analysis protocol. Please stand by.`,
            () => setIsChatThinking(false)
          );
        } catch (e) {
          console.warn("Terminal: Speech acknowledgement failed", e);
          setIsChatThinking(false);
        }

        isAnalysisRunningRef.current = true;
        try {
          const result: any = await handleMarketAnalysis(symbol);
          if (result.summary) {
            await speak(result.summary);
          } else {
            await speak(`I have completed the analysis for ${symbol}. Direction is ${result.verdict}.`);
          }
        } catch (e) {
          console.error("Text analysis failed:", e);
        } finally {
          isAnalysisRunningRef.current = false;
        }
      }, 100);

    } else {
      // General Chat Path - Also deducts 1 credit
      try {
        if (!whopUser?.isUnlimited) {
          await fetch('/api/credits/deduct', { method: 'POST' });
          setWhopUser(prev => prev ? ({ ...prev, credits: Math.max(0, (prev.credits ?? 0) - 1) }) : null);
        }

        console.log("Terminal: Generating text response for", text);
        setOrbState('thinking');
        const responseText = await geminiService.generateTextResponse(text);

        setOrbState(isMicActive ? 'listening' : 'idle');
        await speak(responseText, () => {
          addMessage('ai', responseText);
          setIsChatThinking(false);
        });

      } catch (e: any) {
        console.error("Text response failed:", e);
        setIsChatThinking(false);
        setOrbState('idle');
      }
    }
  };

  const handleUpgradeClick = async () => {
    try {
      setIsCheckoutLoading(true);
      const res = await fetch('/api/checkout/session', {
        method: 'POST',
        headers: {
          'x-whop-user-token': (document.cookie.match(/whop_user_token=([^;]+)/)?.[1] || '')
        }
      });
      const data = await res.json();
      if (data.sessionId) {
        setCheckoutSessionId(data.sessionId);
        setShowCheckoutModal(true);
      } else {
        setError("Failed to initialize upgrade flow. Please try again.");
      }
    } catch (e) {
      console.error("Upgrade error:", e);
      setError("Failed to connect to checkout.");
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  // --- RENDER ---
  if (isWhopLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">Personalizing Nova...</p>
        </div>
      </div>
    );
  }

  if (whopUser && whopAccess && !whopAccess.has_access) {
    return <MembershipGate />;
  }

  return (
    <>
      <div className="flex h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30 overflow-hidden">

        {/* Background */}
        <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-900/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-emerald-900/10 rounded-full blur-[120px]" />
        </div>

        {/* SIDEBAR */}
        <div className={clsx(
          "fixed inset-y-0 left-0 z-40 w-[320px] bg-slate-950/90 backdrop-blur-xl border-r border-slate-800 transition-transform duration-300 flex flex-col shadow-2xl",
          showLog ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="h-16 flex items-center px-4 border-b border-slate-800/50 bg-slate-900/40">
            <div className="flex items-center gap-3">
              <Terminal className="text-emerald-500" size={18} />
              <span className="text-sm font-mono tracking-wider text-slate-300">SYSTEM LOG</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs custom-scrollbar">
            {messages.map(m => (
              <div key={m.id} className={clsx("flex flex-col gap-1", m.role === 'user' ? "items-end" : "items-start")}>
                <span className={clsx("px-2 py-0.5 rounded text-[10px] uppercase font-bold",
                  m.role === 'user' ? "bg-slate-800 text-slate-400" : "bg-emerald-950 text-emerald-500")}>
                  {m.role === 'user' ? 'USER' : 'NOVA'}
                </span>
                <div className={clsx("p-2 rounded-lg max-w-[95%] break-words border",
                  m.role === 'user' ? "bg-slate-900/50 border-slate-800" : "bg-emerald-900/10 border-emerald-900/30")}>
                  {m.text}
                </div>
              </div>
            ))}

            {isChatThinking && (
              <div className="flex flex-col items-start gap-1">
                <span className="bg-emerald-950 text-emerald-500 px-2 py-0.5 rounded text-[10px] uppercase font-bold">
                  NOVA
                </span>
                <div className="p-2 rounded-lg bg-emerald-900/10 border border-emerald-900/30 text-emerald-500/70 text-[10px] font-mono italic">
                  Nova is thinking
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-slate-900/80 border-t border-slate-800/50">
            <form onSubmit={handleTextSubmit} className="relative">
              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                disabled={!isMicActive || isSystemBusy}
                placeholder={!isMicActive ? "Initialize system to chat..." : isSystemBusy ? "Nova is busy..." : "System command line..."}
                className={clsx(
                  "w-full bg-slate-950 border border-slate-800 rounded-lg py-3 pl-4 pr-10 text-xs transition-all",
                  (!isMicActive || isSystemBusy) ? "text-slate-600 cursor-not-allowed opacity-50" : "text-slate-300 focus:outline-none focus:border-emerald-500/50"
                )}
              />
              <button
                type="submit"
                disabled={!isMicActive || isSystemBusy}
                className={clsx(
                  "absolute right-2 top-1/2 -translate-y-1/2 transition-colors",
                  (!isMicActive || isSystemBusy) ? "text-slate-700 cursor-not-allowed" : "text-slate-500 hover:text-emerald-500"
                )}
              >
                <Send size={14} />
              </button>
            </form>
            <div className="mt-3 text-center px-2">
              <p className="text-[10px] font-mono text-slate-500/50 tracking-wider">
                Tips: Use voice mode for faster response.
              </p>
            </div>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className={clsx("flex-1 flex flex-col relative z-10 transition-all duration-300 h-full", showLog ? "ml-[320px]" : "ml-0")}>

          <div className="h-16 px-6 flex items-center justify-between z-30 pointer-events-none">
            {/* LEFT: Sidebar Toggle + Profile */}
            <div className="flex items-center gap-4 pointer-events-auto">
              <button onClick={() => setShowLog(!showLog)} className="p-1 text-slate-500 hover:text-white transition-all duration-300 hover:bg-white/5 rounded-md pointer-events-auto flex items-center justify-center">
                {showLog ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
              </button>

              {whopUser && (
                <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-4 duration-500">
                  <div className="relative group">
                    {whopUser.profile_picture ? (
                      <img src={whopUser.profile_picture} alt={whopUser.name} className="w-9 h-9 rounded-full border-2 border-emerald-500/30 group-hover:border-emerald-500/60 transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)]" />
                    ) : (
                      <div className="w-9 h-9 bg-slate-800 rounded-full flex items-center justify-center text-xs text-slate-400 font-bold border border-slate-700">
                        {whopUser.name?.[0] || 'U'}
                      </div>
                    )}
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-950 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  </div>

                  <div className="flex flex-col">
                    <p className="text-xs font-bold text-slate-100 leading-none mb-1">{whopUser.name}</p>
                    <p className="text-[10px] font-mono text-slate-500/40 uppercase tracking-[0.15em] font-medium italic">Quantum Operator</p>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT: Credits + Upgrade + Error */}
            <div className="flex items-center gap-4 pointer-events-auto">
              {whopUser && (
                <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-4 duration-500">
                  <div className={clsx(
                    "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black tracking-tight border shadow-sm transition-all",
                    whopUser.isUnlimited
                      ? "bg-purple-500/10 text-purple-400 border-purple-500/20 shadow-purple-900/10"
                      : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-emerald-900/10"
                  )}>
                    <Zap size={10} className={clsx("fill-current", whopUser.isUnlimited ? "text-purple-400" : "text-emerald-400")} />
                    <span>{whopUser.isUnlimited ? "UNLIMITED" : `${whopUser.credits ?? 0} CREDITS`}</span>
                  </div>

                  {!whopUser.isUnlimited && (
                    <button
                      onClick={handleUpgradeClick}
                      disabled={isCheckoutLoading}
                      className="hidden lg:block px-4 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-md text-[10px] font-bold text-white hover:opacity-90 hover:scale-105 transition-all shadow-lg shadow-purple-900/20 disabled:opacity-50"
                    >
                      {isCheckoutLoading ? '...' : 'UPGRADE'}
                    </button>
                  )}
                </div>
              )}

              {error && <div className="px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs backdrop-blur-md">{error}</div>}
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative">
            <div className="absolute inset-0 overflow-y-auto custom-scrollbar">

              {/* IDLE STATE */}
              {!marketState && !isMicActive && (
                <div className="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in zoom-in duration-700">
                  <div className="relative w-32 h-32 md:w-48 md:h-48">
                    <VoiceOrb state="idle" volume={0} />
                  </div>
                  <div className="text-center">
                    <h1 className="text-5xl font-extralight text-white tracking-[0.2em] mb-2">NOVA</h1>
                    <div className="text-xs font-mono text-emerald-500 tracking-[0.3em] uppercase opacity-80">Quantum Market Intelligence</div>
                  </div>
                  <button
                    onClick={startMic}
                    className="group relative px-10 py-5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full text-slate-950 font-bold tracking-widest hover:scale-105 transition-all flex items-center gap-3 z-20"
                  >
                    <Power size={20} /> INITIALIZE SYSTEM
                  </button>
                </div>
              )}

              {/* ACTIVE SESSION STATE (Orb + Dynamic Labels) */}
              {!marketState && isMicActive && (
                <div className="flex flex-col items-center justify-center h-full space-y-8 mt-[-60px]">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-80 h-80 relative">
                      <VoiceOrb state={orbState} volume={volume} />
                    </div>
                    {orbState === 'listening' && <TypewriterHint />}
                  </div>
                  <div className="text-2xl font-light text-white tracking-[0.2em] uppercase animate-pulse">
                    {orbState === 'speaking' ? 'Speaking...' :
                      orbState === 'thinking' ? 'Thinking...' : 'Listening...'}
                  </div>
                </div>
              )}

              {/* DASHBOARD */}
              {marketState && (
                <AnalysisDashboard
                  data={marketState}
                  onTypingComplete={handleAnalysisVisualComplete}
                />
              )}
            </div>
          </div>

          {/* DOCK */}
          {(isMicActive || marketState) && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50">
              <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-full p-2 pr-6 shadow-2xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-slate-950/50 border border-slate-800 overflow-hidden relative flex items-center justify-center">
                  <div className="w-full h-full scale-150 opacity-80"><VoiceOrb state={orbState} volume={volume} /></div>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Voice Link</span>
                  <span className={clsx("text-xs font-mono", isMicActive ? "text-emerald-400" : "text-red-400")}>
                    {isMicActive ? (isMuted ? 'MUTED' : 'CONNECTED') : 'PAUSED'}
                  </span>
                </div>
                <div className="h-8 w-px bg-slate-700/50 mx-2" />

                {/* End Call */}
                <button
                  onClick={stopMic}
                  disabled={isSystemBusy}
                  className={clsx(
                    "h-10 w-10 rounded-full flex items-center justify-center transition-all shadow-lg",
                    isSystemBusy
                      ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                      : "bg-red-500 text-white shadow-red-500/20 hover:bg-red-600 hover:scale-110"
                  )}
                  title={isSystemBusy ? "Analysis in Progress" : "End Call"}
                >
                  <Phone size={20} className="rotate-[135deg]" />
                </button>

                {/* Mute Toggle */}
                <button
                  onClick={toggleMute}
                  disabled={isSystemBusy}
                  className={clsx("h-10 w-10 rounded-full flex items-center justify-center transition-all",
                    isSystemBusy
                      ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                      : isMuted
                        ? "bg-slate-700 text-slate-400"
                        : "bg-emerald-500 text-slate-900 shadow-lg shadow-emerald-500/20"
                  )}
                  title={isSystemBusy ? "Analysis in Progress" : (isMuted ? "Unmute" : "Mute")}
                >
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                {/* Device Selector Toggle */}
                <div className="relative">
                  <button
                    onClick={() => !isSystemBusy && setShowSettings(!showSettings)}
                    disabled={isSystemBusy}
                    className={clsx("p-2 rounded-full transition-colors",
                      isSystemBusy ? "text-slate-700 cursor-not-allowed" :
                        showSettings ? "bg-slate-800 text-emerald-400" : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    <Settings size={16} />
                  </button>

                  {/* Popup Menu */}
                  {showSettings && (
                    <div className="absolute bottom-full right-0 mb-4 w-64 bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-xl p-2 shadow-2xl flex flex-col gap-1 z-[60]">
                      <div className="px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Select Microphone
                      </div>
                      {audioDevices.map(device => (
                        <button
                          key={device.deviceId}
                          onClick={async () => {
                            const deviceId = device.deviceId;
                            setSelectedDeviceId(deviceId);
                            setShowSettings(false);

                            if (isMicActive) {
                              try {
                                console.log("Hot-swapping microphone...");
                                cleanupAudioResources();
                                await startAudioStream(deviceId);
                                console.log("Mic hot-swapped successfully.");
                              } catch (e: any) {
                                console.error("Hot-swap failed:", e);
                                setError("Failed to switch microphone: " + e.message);
                                stopMic(); // Hard reset if hot swap fails
                              }
                            }
                          }}
                          className={clsx(
                            "flex items-center justify-between px-3 py-2 rounded-lg text-xs text-left transition-colors",
                            selectedDeviceId === device.deviceId
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "hover:bg-slate-800 text-slate-300"
                          )}
                        >
                          <span className="truncate max-w-[180px]">{device.label || `Microphone ${device.deviceId.slice(0, 4)}...`}</span>
                          {selectedDeviceId === device.deviceId && <Check size={12} />}
                        </button>
                      ))}

                      {audioDevices.length === 0 && (
                        <div className="px-3 py-2 text-xs text-slate-500 italic">No devices found</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* WHOP CHECKOUT MODAL */}
      {showCheckoutModal && checkoutSessionId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={() => setShowCheckoutModal(false)} />
          <div className="relative w-full max-w-lg bg-[#0a0a0b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="flex items-center justify-between p-4 border-b border-white/5 bg-slate-900/50">
              <h3 className="text-white font-medium flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400" />
                Upgrade to Nova Unlimited
              </h3>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="p-1 hover:bg-white/5 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="p-0 bg-black" style={{ minHeight: '600px', height: '80vh' }}>
              <WhopCheckoutEmbed
                sessionId={checkoutSessionId}
                onComplete={() => {
                  setShowCheckoutModal(false);
                  window.location.reload();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}