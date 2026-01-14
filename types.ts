import { Type } from '@google/genai';

export enum MarketRegime {
  TRENDING_UP = 'TRENDING_UP',
  TRENDING_DOWN = 'TRENDING_DOWN',
  RANGING = 'RANGING',
  CONSOLIDATION = 'CONSOLIDATION',
  VOLATILE = 'VOLATILE'
}

export enum AnalysisStage {
  IDLE = 'IDLE',
  FETCHING_DATA = 'FETCHING_DATA',
  COMPUTING_TECHNICALS = 'COMPUTING_TECHNICALS',
  AGGREGATING_SIGNALS = 'AGGREGATING_SIGNALS',
  GENERATING_THOUGHTS = 'GENERATING_THOUGHTS',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValue {
  name: string;
  value: number | string;
  signal: 'UP' | 'DOWN' | 'NEUTRAL';
  strength: number; // 0-100 confidence
  description?: string;
}

export interface TechnicalAnalysis {
  rsi: IndicatorValue;
  stoch: { k: number; d: number; signal: 'UP' | 'DOWN' | 'NEUTRAL'; strength: number };
  macd: { value: number; histogram: number; signal: 'UP' | 'DOWN' | 'NEUTRAL'; strength: number };
  adx: { value: number; signal: 'UP' | 'DOWN' | 'NEUTRAL'; strength: number };
  atr: { value: number; signal: 'UP' | 'DOWN' | 'NEUTRAL'; strength: number };
  ema: {
    ema12: number;
    ema26: number;
    ema50: number;
    trend: 'UP' | 'DOWN' | 'NEUTRAL';
  };
  momentum: { value: number; signal: 'UP' | 'DOWN' | 'NEUTRAL'; strength: number };
  roc: { value: number; signal: 'UP' | 'DOWN' | 'NEUTRAL'; strength: number };
  bollinger: {
    width: number;
    signal: 'UP' | 'DOWN' | 'NEUTRAL';
    strength: number;
  };
  sma: {
    sma20: number;
    sma50: number;
    sma200: number;
    trend: 'UP' | 'DOWN' | 'NEUTRAL';
    strength: number;
  };
  volume: {
    ratio: number;
    trend: 'UP' | 'DOWN' | 'NEUTRAL';
    strength: number;
    vma20: number;
  };
  patterns: string[];
  summary: {
    upSignals: number;
    downSignals: number;
    neutralSignals: number;
    upScore: number;
    downScore: number;
    alignment: number; // percentage
    regime: MarketRegime;
  };
}

export interface ThoughtStep {
  header: string;
  content: string;
}

export interface DeepAnalysisResult {
  thought_process: ThoughtStep[];
  observations: string[];
  risks: string[];
  verdict: {
    direction: 'UP' | 'DOWN' | 'NEUTRAL';
    confidence: number;
    duration: string;
    summary: string;
    targets?: {
      entry: string;
      stopLoss: string;
      target: string;
    };
    riskReward?: {
      ratio: number;
      recommendation: string;
    };
    marketNarrative?: string;
    btcCorrelation?: string;
  };
}

export interface MarketState {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  dataPoints: number;
  candles: OHLCV[];
  technicals: TechnicalAnalysis | null;
  deepAnalysis: DeepAnalysisResult | null;
  stage: AnalysisStage;
  timings: {
    data: number;
    technicals: number;
    aggregation: number;
    ai: number;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
}

export const CRYPTO_TOOLS = [
  {
    name: 'analyze_market',
    description: 'Fetch market data and perform technical analysis on a cryptocurrency symbol (e.g., BTC, ETH, SOL).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        symbol: {
          type: Type.STRING,
          description: 'The cryptocurrency ticker symbol (e.g. BTC, ETH).',
        },
      },
      required: ['symbol'],
    },
  },
];

export interface WhopUser {
  id: string;
  username: string;
  name: string;
  profile_picture?: string;
}

export interface WhopAccess {
  has_access: boolean;
  access_level: 'no_access' | 'customer' | 'admin';
}