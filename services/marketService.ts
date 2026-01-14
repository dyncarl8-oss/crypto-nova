import { CRYPTOCOMPARE_API_KEY, CRYPTOCOMPARE_BASE_URL } from '../constants';
import { OHLCV, TechnicalAnalysis, MarketRegime } from '../types';

// --- SYMBOL MAPPING ---

const SYMBOL_MAP: Record<string, string> = {
  'BITCOIN': 'BTC',
  'ETHEREUM': 'ETH',
  'SOLANA': 'SOL',
  'CARDANO': 'ADA',
  'RIPPLE': 'XRP',
  'POLKADOT': 'DOT',
  'DOGECOIN': 'DOGE',
  'LITECOIN': 'LTC',
  'CHAINLINK': 'LINK',
  'STELLAR': 'XLM',
  'SHIBA INU': 'SHIB',
  'AVALANCHE': 'AVAX',
  'POLYGON': 'MATIC',
  'TRON': 'TRX'
};

function normalizeSymbol(input: string): string {
  const cleaned = input.trim().toUpperCase();
  return SYMBOL_MAP[cleaned] || cleaned;
}

// --- API FETCHING ---

export async function fetchOHLCV(rawSymbol: string, limit = 300): Promise<{ candles: OHLCV[]; pair: string }> {
  const symbol = normalizeSymbol(rawSymbol);
  // Try USDT first, then USD
  const pairs = ['USDT', 'USD'];
  let lastError = null;

  for (const quote of pairs) {
    try {
      const url = `${CRYPTOCOMPARE_BASE_URL}/v2/histohour?fsym=${symbol}&tsym=${quote}&limit=${limit}&api_key=${CRYPTOCOMPARE_API_KEY}`;
      console.log(`fetchOHLCV: Calling ${url}`);
      const res = await fetch(url);
      const json = await res.json();
      console.log(`fetchOHLCV: Response for ${symbol}/${quote}: ${json.Response}`);

      if (json.Response === 'Error') {
        throw new Error(json.Message);
      }

      const candles = json.Data.Data.map((d: any) => ({
        time: d.time * 1000,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volumeto, // Quote volume
      }));

      return { candles, pair: `${symbol.toUpperCase()}/${quote}` };
    } catch (e: any) {
      console.warn(`Failed to fetch ${symbol}/${quote}:`, e.message);
      lastError = e;
    }
  }

  throw lastError || new Error(`Failed to fetch data for ${symbol}`);
}

export async function fetchCurrentPrice(rawSymbol: string): Promise<{ price: number; change24h: number; pair: string }> {
  const symbol = normalizeSymbol(rawSymbol);
  const pairs = ['USDT', 'USD'];
  let lastError = null;

  for (const quote of pairs) {
    try {
      const url = `${CRYPTOCOMPARE_BASE_URL}/pricemultifull?fsyms=${symbol}&tsyms=${quote}&api_key=${CRYPTOCOMPARE_API_KEY}`;
      console.log(`fetchCurrentPrice: Calling ${url}`);
      const res = await fetch(url);
      const json = await res.json();

      const data = json.RAW?.[symbol]?.[quote];
      console.log(`fetchCurrentPrice: Data for ${symbol}/${quote}: ${data ? 'Found' : 'NOT FOUND'}`);
      if (!data) throw new Error(`${symbol}/${quote} not found`);

      return {
        price: data.PRICE,
        change24h: data.CHANGEPCT24HOUR,
        pair: `${symbol.toUpperCase()}/${quote}`
      };
    } catch (e: any) {
      console.warn(`Failed to fetch price for ${symbol}/${quote}:`, e.message);
      lastError = e;
    }
  }

  throw lastError || new Error(`Symbol ${symbol} not found`);
}

// --- MATH HELPERS ---

function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1];
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(closes: number[], period = 14) {
  if (closes.length < period + 1) return { value: 50, signal: 'NEUTRAL', strength: 50 };

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[closes.length - i] - closes[closes.length - i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  const rs = (gains / period) / (losses / period === 0 ? 1 : losses / period);
  const rsi = 100 - (100 / (1 + rs));

  let signal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let strength = 50;

  if (rsi < 30) { signal = 'UP'; strength = 80 + (30 - rsi); } // Oversold = Buy
  else if (rsi > 70) { signal = 'DOWN'; strength = 80 + (rsi - 70); } // Overbought = Sell
  else {
    // Neutral but directional
    if (rsi > 55) { signal = 'UP'; strength = 55; }
    else if (rsi < 45) { signal = 'DOWN'; strength = 55; }
  }

  return { value: rsi, signal, strength };
}

function calculateStoch(closes: number[], highs: number[], lows: number[], period = 14) {
  if (closes.length < period) return { k: 50, d: 50, signal: 'NEUTRAL', strength: 50 };

  const currentClose = closes[closes.length - 1];
  const periodLows = lows.slice(-period);
  const periodHighs = highs.slice(-period);
  const lowestLow = Math.min(...periodLows);
  const highestHigh = Math.max(...periodHighs);

  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  // Simple mock for D (3-period SMA of K)
  const d = k;

  let signal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let strength = 50;
  if (k < 20) { signal = 'UP'; strength = 90; }
  else if (k > 80) { signal = 'DOWN'; strength = 90; }

  return { k, d, signal, strength } as any;
}

function calculateBollinger(closes: number[], period = 20) {
  const sma = calculateSMA(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = sma + (2 * stdDev);
  const lower = sma - (2 * stdDev);
  const current = closes[closes.length - 1];

  const widthPct = ((upper - lower) / sma) * 100;

  let signal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let strength = 50;

  if (current < lower) { signal = 'UP'; strength = 75; }
  else if (current > upper) { signal = 'DOWN'; strength = 75; }

  return { upper, lower, middle: sma, width: widthPct, signal, strength } as any;
}

function calculateMomentum(closes: number[], period = 10) {
  const current = closes[closes.length - 1];
  const prev = closes[closes.length - period - 1];
  const mom = current - prev;

  let signal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  if (mom > 0) signal = 'UP';
  else if (mom < 0) signal = 'DOWN';

  return { value: mom, signal, strength: 50 + Math.min(50, Math.abs(mom)) } as any;
}

function calculateROC(closes: number[], period = 14) {
  const current = closes[closes.length - 1];
  const prev = closes[closes.length - period - 1];
  const roc = ((current - prev) / prev) * 100;

  let signal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  if (roc > 0.5) signal = 'UP';
  else if (roc < -0.5) signal = 'DOWN';

  return { value: roc, signal, strength: 50 + Math.min(50, Math.abs(roc) * 10) } as any;
}

// --- ANALYSIS LOGIC ---

export function analyzeMarket(candles: OHLCV[]): TechnicalAnalysis {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const currentPrice = closes[closes.length - 1];

  // Indicators
  const rsi = calculateRSI(closes);
  const stoch = calculateStoch(closes, highs, lows);
  const bb = calculateBollinger(closes);
  const momentum = calculateMomentum(closes);
  const roc = calculateROC(closes);
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);

  // Trend
  let trendSignal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let trendStrength = 50;
  if (currentPrice > sma50) {
    trendSignal = 'UP';
    trendStrength = 60;
    if (sma50 > sma200) trendStrength = 80;
  } else {
    trendSignal = 'DOWN';
    trendStrength = 60;
    if (sma50 < sma200) trendStrength = 80;
  }

  // MACD (Simplified)
  const ema12 = calculateSMA(closes.slice(-12), 12); // approx
  const ema26 = calculateSMA(closes.slice(-26), 26);
  const macdVal = ema12 - ema26;
  let macdSignal: 'UP' | 'DOWN' | 'NEUTRAL' = macdVal > 0 ? 'UP' : 'DOWN';

  // Volume
  const avgVol = calculateSMA(volumes, 20);
  const currentVol = volumes[volumes.length - 1];
  const volRatio = currentVol / avgVol;
  let volSignal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  if (volRatio > 1.5 && closes[closes.length - 1] > closes[closes.length - 2]) volSignal = 'UP';
  else if (volRatio > 1.5) volSignal = 'DOWN';

  // Scoring
  const signals = [rsi, stoch, bb, momentum, roc, { signal: trendSignal }, { signal: macdSignal }, { signal: volSignal }];
  let upSignals = signals.filter(s => s.signal === 'UP').length;
  let downSignals = signals.filter(s => s.signal === 'DOWN').length;
  let neutralSignals = signals.filter(s => s.signal === 'NEUTRAL').length;

  // Weighted Score (Mock calculation for display)
  const upScore = (upSignals * 50) + (rsi.signal === 'UP' ? rsi.strength : 0) + (trendSignal === 'UP' ? trendStrength : 0);
  const downScore = (downSignals * 50) + (rsi.signal === 'DOWN' ? rsi.strength : 0) + (trendSignal === 'DOWN' ? trendStrength : 0);
  const totalScore = upScore + downScore + 1;
  const alignment = Math.max(upScore, downScore) / totalScore * 100;

  // Regime
  let regime = MarketRegime.RANGING;
  if (trendSignal === 'UP' && alignment > 60) regime = MarketRegime.TRENDING_UP;
  else if (trendSignal === 'DOWN' && alignment > 60) regime = MarketRegime.TRENDING_DOWN;
  if (bb.width < 3.0) regime = MarketRegime.CONSOLIDATION;

  return {
    rsi: { name: 'RSI', value: rsi.value.toFixed(1), signal: rsi.signal as any, strength: rsi.strength },
    stoch: { ...stoch, signal: stoch.signal as any },
    macd: { value: macdVal, signal: macdSignal, strength: 75 },
    adx: { value: 25, signal: 'NEUTRAL', strength: 50 }, // Mock ADX
    momentum: { value: momentum.value, signal: momentum.signal as any, strength: momentum.strength },
    roc: { value: roc.value, signal: roc.signal as any, strength: roc.strength },
    bollinger: { ...bb, signal: bb.signal as any },
    sma: { sma20, sma50, sma200, trend: trendSignal, strength: trendStrength },
    volume: { ratio: volRatio, trend: volSignal, strength: Math.min(100, volRatio * 50) },
    summary: {
      upSignals,
      downSignals,
      neutralSignals,
      upScore,
      downScore,
      alignment,
      regime
    }
  };
}