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

export async function fetchOHLCV(rawSymbol: string, limit = 300, interval = 'hour'): Promise<{ candles: OHLCV[]; pair: string }> {
  const symbol = normalizeSymbol(rawSymbol);
  const pairs = ['USDT', 'USD'];
  let lastError = null;

  const endpoint = interval === 'minute' ? 'histominute' : interval === 'day' ? 'histoday' : 'histohour';

  for (const quote of pairs) {
    try {
      const url = `${CRYPTOCOMPARE_BASE_URL}/v2/${endpoint}?fsym=${symbol}&tsym=${quote}&limit=${limit}&api_key=${CRYPTOCOMPARE_API_KEY}`;
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

export async function fetchNews(rawSymbol: string): Promise<string[]> {
  const symbol = normalizeSymbol(rawSymbol);
  try {
    const url = `${CRYPTOCOMPARE_BASE_URL}/v2/news/?categories=${symbol}&limit=5&api_key=${CRYPTOCOMPARE_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.Data && Array.isArray(json.Data)) {
      return json.Data.map((item: any) => item.title);
    }
    return [];
  } catch (e) {
    console.warn("Failed to fetch news:", e);
    return [];
  }
}

// --- MATH HELPERS ---

function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1] || 0;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = (data[i] * k) + (ema * (1 - k));
  }
  return ema;
}

function calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const hcp = Math.abs(highs[i] - closes[i - 1]);
    const lcp = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hcp, lcp));
  }
  return calculateSMA(trs, period);
}

function calculateADX(highs: number[], lows: number[], closes: number[], period = 14) {
  if (closes.length < period * 2) return { value: 15, signal: 'NEUTRAL', strength: 50 };

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const hl = highs[i] - lows[i];
    const hcp = Math.abs(highs[i] - closes[i - 1]);
    const lcp = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hcp, lcp));
  }

  const smoothTR = calculateEMA(trs, period);
  const smoothPlusDM = calculateEMA(plusDM, period);
  const smoothMinusDM = calculateEMA(minusDM, period);

  const plusDI = (smoothPlusDM / smoothTR) * 100;
  const minusDI = (smoothMinusDM / smoothTR) * 100;
  const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;

  // Simple ADX smoothing
  const adx = dx;

  let signal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  if (adx > 25) {
    signal = plusDI > minusDI ? 'UP' : 'DOWN';
  }

  return { value: adx, signal, strength: Math.min(100, adx * 2) };
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

  if (rsi < 30) { signal = 'UP'; strength = 85; }
  else if (rsi > 70) { signal = 'DOWN'; strength = 85; }
  else if (rsi > 55) { signal = 'UP'; strength = 60; }
  else if (rsi < 45) { signal = 'DOWN'; strength = 60; }

  return { value: rsi, signal, strength };
}

function calculateStoch(closes: number[], highs: number[], lows: number[], period = 14) {
  if (closes.length < period) return { k: 50, d: 50, signal: 'NEUTRAL', strength: 50 };
  const currentClose = closes[closes.length - 1];
  const lowestLow = Math.min(...lows.slice(-period));
  const highestHigh = Math.max(...highs.slice(-period));

  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow || 1)) * 100;
  const d = k; // Simplified

  let signal: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  if (k < 20) signal = 'UP';
  else if (k > 80) signal = 'DOWN';

  return { k, d, signal, strength: 80 };
}

function detectPatterns(candles: OHLCV[]): string[] {
  const patterns: string[] = [];
  if (candles.length < 3) return patterns;

  const c1 = candles[candles.length - 1];
  const c2 = candles[candles.length - 2];

  // Engulfing
  const body1 = Math.abs(c1.close - c1.open);
  const body2 = Math.abs(c2.close - c2.open);
  if (body1 > body2 * 1.5) {
    if (c1.close > c1.open && c2.close < c2.open) patterns.push("Bullish Engulfing");
    if (c1.close < c1.open && c2.close > c2.open) patterns.push("Bearish Engulfing");
  }

  // Pin Bar (Hammer/Shooting Star)
  const totalRange = c1.high - c1.low;
  const upperWick = c1.high - Math.max(c1.open, c1.close);
  const lowerWick = Math.min(c1.open, c1.close) - c1.low;

  if (lowerWick > body1 * 2.5) patterns.push("Bullish Hammer");
  if (upperWick > body1 * 2.5) patterns.push("Shooting Star");

  return patterns;
}

// --- ANALYSIS LOGIC ---

export function analyzeMarket(candles: OHLCV[]): TechnicalAnalysis {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const currentPrice = closes[closes.length - 1];

  // Core Indicators
  const rsi = calculateRSI(closes);
  const stoch = calculateStoch(closes, highs, lows);
  const adx = calculateADX(highs, lows, closes);
  const atr = calculateATR(highs, lows, closes);

  // EMAs
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const ema50 = calculateEMA(closes, 50);

  // SMAs
  const { sma20, sma50, sma200 } = {
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
    sma200: calculateSMA(closes, 200)
  };

  // MACD
  const macdVal = ema12 - ema26;
  const histogram = macdVal; // Simplified for performance

  // Volume
  const vma20 = calculateSMA(volumes, 20);
  const volRatio = volumes[volumes.length - 1] / vma20;

  // Patterns
  const patterns = detectPatterns(candles);

  // Scoring & Summary
  const upSignals = [rsi, stoch, adx].filter(s => s.signal === 'UP').length;
  const downSignals = [rsi, stoch, adx].filter(s => s.signal === 'DOWN').length;

  const alignment = (Math.max(upSignals, downSignals) / 3) * 100;

  let regime = MarketRegime.RANGING;
  if (adx.value > 25) {
    regime = ema12 > ema26 ? MarketRegime.TRENDING_UP : MarketRegime.TRENDING_DOWN;
  } else if (volRatio < 0.8) {
    regime = MarketRegime.CONSOLIDATION;
  }

  return {
    rsi: { ...rsi, name: 'RSI', value: rsi.value.toFixed(1), signal: rsi.signal as any },
    stoch: { ...stoch, signal: stoch.signal as any },
    macd: { value: macdVal, histogram, signal: macdVal > 0 ? 'UP' : 'DOWN', strength: 75 },
    adx: { ...adx, signal: adx.signal as any },
    atr: { value: atr, signal: 'NEUTRAL', strength: 50 },
    ema: { ema12, ema26, ema50, trend: ema12 > ema50 ? 'UP' : 'DOWN' },
    momentum: { value: 0, signal: 'NEUTRAL', strength: 50 }, // Placeholder
    roc: { value: 0, signal: 'NEUTRAL', strength: 50 }, // Placeholder
    bollinger: { width: 0, signal: 'NEUTRAL', strength: 50 }, // Placeholder
    sma: { sma20, sma50, sma200, trend: currentPrice > sma50 ? 'UP' : 'DOWN', strength: 70 },
    volume: { ratio: volRatio, trend: volRatio > 1.2 ? 'UP' : 'NEUTRAL', strength: 70, vma20 },
    patterns,
    summary: {
      upSignals,
      downSignals,
      neutralSignals: 3 - (upSignals + downSignals),
      upScore: upSignals * 33,
      downScore: downSignals * 33,
      alignment,
      regime
    }
  };
}