import React, { useState, useEffect, useRef } from 'react';
import { MarketState, AnalysisStage, ThoughtStep } from '../types';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip, XAxis, ReferenceLine, ReferenceArea } from 'recharts';
import {
    ChevronDown, ChevronUp, CheckCircle2, Circle, Loader2,
    Brain, AlertTriangle, TrendingUp, Check
} from 'lucide-react';
import clsx from 'clsx';

interface Props {
    data: MarketState | null;
    onTypingComplete?: () => void;
}

// --- HELPER COMPONENTS ---

const StatusIcon = ({ status, active }: { status: 'PENDING' | 'ACTIVE' | 'COMPLETE', active: boolean }) => {
    if (status === 'COMPLETE') return <CheckCircle2 className="text-emerald-500" size={20} />;
    if (active) return <Loader2 className="text-blue-500 animate-spin" size={20} />;
    return <Circle className="text-slate-700" size={20} />;
};

const MetricRow = ({ label, value, subtext, color = 'slate' }: any) => (
    <div className="flex justify-between items-start py-2 border-b border-slate-800/50 last:border-0">
        <span className="text-slate-400 text-sm">{label}</span>
        <div className="text-right">
            <div className={clsx("font-mono font-medium", `text-${color}-400`)}>{value}</div>
            {subtext && <div className="text-[10px] text-slate-500">{subtext}</div>}
        </div>
    </div>
);

const StrengthBar = ({ value, color = 'emerald' }: { value: number, color?: string }) => (
    <div className="h-1 w-full bg-slate-800 rounded-full mt-1 overflow-hidden">
        <div
            className={clsx("h-full rounded-full transition-all duration-1000", `bg-${color}-500`)}
            style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
    </div>
);

const DiagnosticConsole = ({ logs }: { logs: string[] }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div
            ref={scrollRef}
            className="bg-black/40 border border-slate-800 rounded-lg p-3 font-mono text-[10px] text-emerald-500/80 h-32 overflow-y-auto mb-4 custom-scrollbar space-y-1"
        >
            {logs.map((log, i) => (
                <div key={i} className="animate-in fade-in slide-in-from-left-2 duration-300">
                    <span className="text-slate-600 mr-2">[{new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}]</span>
                    {log}
                </div>
            ))}
        </div>
    );
};

const DecisionMatrix = ({ technicals, anchorTechnicals }: { technicals: any, anchorTechnicals: any }) => {
    const checks = [
        { label: "ADX Trend Strength", pass: technicals.adx.value >= 12, value: technicals.adx.value.toFixed(1) },
        { label: "Volume Fuel (20d)", pass: technicals.volume.ratio >= 0.8, value: `${technicals.volume.ratio.toFixed(2)}x` },
        { label: "MTF Trend Sync", pass: technicals.sma.trend === anchorTechnicals?.sma.trend, value: `${technicals.sma.trend} vs ${anchorTechnicals?.sma.trend || '...'}` },
        { label: "ATR Volatility Guard", pass: true, value: "ENABLED" } // Handled by backend logic
    ];

    return (
        <div className="grid grid-cols-2 gap-2 mt-4">
            {checks.map((check, i) => (
                <div key={i} className="bg-slate-900/40 border border-slate-800/50 p-2 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {check.pass ? <Check size={10} className="text-emerald-500" /> : <AlertTriangle size={10} className="text-amber-500" />}
                        <span className="text-[9px] text-slate-400 uppercase font-bold">{check.label}</span>
                    </div>
                    <span className={clsx("text-[9px] font-mono", check.pass ? "text-emerald-400" : "text-amber-400")}>{check.value}</span>
                </div>
            ))}
        </div>
    );
};

const SentinelNewsAudit = ({ news }: { news: string[] }) => {
    if (!news || news.length === 0) return null;
    return (
        <div className="space-y-2 mt-4">
            <div className="flex items-center gap-2 mb-2">
                <Check size={12} className="text-emerald-500" />
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Sentiment Audit: Ingested Headlines</span>
            </div>
            {news.map((n, i) => (
                <div key={i} className="bg-slate-900/40 border border-slate-800/50 p-2.5 rounded-lg text-[10px] text-slate-400 font-light flex gap-3 transition-colors hover:bg-slate-800/40">
                    <span className="text-slate-600 font-mono">#{i + 1}</span>
                    <p className="line-clamp-1 flex-1">{n}</p>
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50 mt-1" /> {/* Sentiment Indicator */}
                </div>
            ))}
        </div>
    );
};

const IndicatorCard = ({ name, signal, value, subtext, strength }: any) => {
    const color = signal === 'UP' ? 'emerald' : signal === 'DOWN' ? 'red' : 'slate';
    return (
        <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
            <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-slate-500 uppercase">{name}</span>
                <span className={clsx("text-xs font-bold px-1.5 py-0.5 rounded",
                    signal === 'UP' ? "bg-emerald-500/10 text-emerald-400" :
                        signal === 'DOWN' ? "bg-red-500/10 text-red-400" : "bg-slate-700/50 text-slate-400")}>
                    {signal}
                </span>
            </div>
            <div className="text-sm font-mono text-slate-200">{subtext}</div>
            <div className="flex justify-between items-end mt-1">
                <span className="text-[10px] text-slate-500">{value}</span>
                <span className="text-[10px] text-slate-500">Strength: {strength}</span>
            </div>
            <StrengthBar value={strength} color={color} />
        </div>
    );
};

// --- TYPEWRITER COMPONENTS ---

const ThinkingLoader = ({ symbol }: { symbol?: string }) => {
    const [text, setText] = useState("Initializing neural pathways...");
    const [dataStream, setDataStream] = useState<string[]>([]);

    const isBTC = symbol?.includes('BTC');
    const isETH = symbol?.includes('ETH');

    const messages = [
        "Analyzing historical patterns...",
        "Evaluating market sentiment...",
        "Calculating risk probabilities...",
        "Synthesizing technical signals...",
        isBTC ? "Analyzing Global Liquidity & Dominance..." :
            isETH ? "Evaluating ETH/BTC Ratio Strength..." :
                "Calculating BTC Correlation Beta...",
        "Formulating trade hypothesis...",
        "Scanning for liquidity walls..."
    ];

    useEffect(() => {
        let i = 0;
        const interval = setInterval(() => {
            setText(messages[i % messages.length]);
            const stream = Array.from({ length: 5 }, () => (Math.random() * 100).toFixed(4));
            setDataStream(stream);
            i++;
        }, 1500);
        return () => clearInterval(interval);
    }, [symbol]); // Reset if symbol changes

    return (
        <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 text-blue-400 text-xs font-mono animate-pulse">
                <Loader2 size={14} className="animate-spin" />
                <span>{text}</span>
            </div>
            <div className="grid grid-cols-5 gap-2">
                {dataStream.map((val, idx) => (
                    <div key={idx} className="text-[8px] text-slate-800 font-mono truncate">
                        {val}
                    </div>
                ))}
            </div>
        </div>
    );
}

const TypewriterText = ({ text, delay = 0, onComplete }: { text: string, delay?: number, onComplete?: () => void }) => {
    const [visibleChars, setVisibleChars] = useState(0);
    const [hasStarted, setHasStarted] = useState(false);

    useEffect(() => {
        const startTimeout = setTimeout(() => {
            setHasStarted(true);
        }, delay);
        return () => clearTimeout(startTimeout);
    }, [delay, text]); // Added text to deps for resets

    useEffect(() => {
        if (!hasStarted) return;

        if (visibleChars < text.length) {
            const speed = Math.max(3, 15 - Math.min(8, text.length / 100));
            const variance = Math.random() * 10;

            const timeout = setTimeout(() => {
                setVisibleChars(prev => prev + 1);
            }, speed + variance);
            return () => clearTimeout(timeout);
        } else {
            onComplete?.();
        }
    }, [visibleChars, text, hasStarted, onComplete]);

    return <span>{text.slice(0, visibleChars)}{visibleChars < text.length && hasStarted ? <span className="animate-pulse text-purple-400">▍</span> : ''}</span>;
};

const ThinkingReveal = ({ steps, onAllComplete }: { steps: ThoughtStep[], onAllComplete?: () => void }) => {
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const stepsRef = useRef(steps);

    useEffect(() => {
        // If steps change drastically, reset (not expected in this flow but good safety)
        if (steps !== stepsRef.current) {
            stepsRef.current = steps;
            setCurrentStepIndex(0);
        }
    }, [steps]);

    useEffect(() => {
        if (currentStepIndex >= steps.length) {
            onAllComplete?.();
        }
    }, [currentStepIndex, steps.length, onAllComplete]);

    return (
        <div className="space-y-6">
            {steps.map((step, idx) => {
                // Only render steps up to the current one
                if (idx > currentStepIndex) return null;

                return (
                    <div key={idx} className="relative pl-4 border-l-2 border-slate-800">
                        {/* Dot indicator */}
                        <div className={clsx("absolute -left-[5px] top-1 w-2 h-2 rounded-full transition-colors duration-300",
                            idx === currentStepIndex ? "bg-purple-500 animate-pulse" : "bg-slate-700")}
                        />

                        <span className="text-purple-300 font-bold block mb-1 text-[10px] tracking-wider uppercase">
                            {idx === currentStepIndex ? (
                                <TypewriterText text={`> ${step.header}`} />
                            ) : (
                                `> ${step.header}`
                            )}
                        </span>
                        <div className="text-slate-400 font-light leading-relaxed">
                            {idx === currentStepIndex ? (
                                <TypewriterText
                                    text={step.content}
                                    delay={400} // Wait a bit after header
                                    onComplete={() => setCurrentStepIndex(prev => prev + 1)}
                                />
                            ) : (
                                step.content
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const AnalysisStep = ({
    title, subtitle, status, duration, children, isLast
}: {
    title: string, subtitle?: string, status: 'PENDING' | 'ACTIVE' | 'COMPLETE', duration?: string, children?: React.ReactNode, isLast?: boolean
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const stepRef = useRef<HTMLDivElement>(null);
    const isActive = status === 'ACTIVE';
    const isComplete = status === 'COMPLETE';

    useEffect(() => {
        if (isActive) {
            setIsOpen(true);
            setTimeout(() => {
                stepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
        // Force open and scroll to last step when it completes (Visual Verdict)
        if (isLast && isComplete) {
            setIsOpen(true);
            setTimeout(() => {
                stepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    }, [isActive, isLast, isComplete]);

    return (
        <div ref={stepRef} className={clsx("relative pl-8 pb-8 transition-opacity duration-500", status === 'PENDING' ? "opacity-50 blur-[1px]" : "opacity-100")}>
            {/* Timeline Line */}
            {!isLast && (
                <div className={clsx("absolute left-[9px] top-6 bottom-0 w-0.5 transition-colors duration-500",
                    isComplete ? "bg-slate-700" : "bg-slate-800/30")}
                />
            )}

            {/* Icon */}
            <div className="absolute left-0 top-0 bg-[#020617] z-10 box-border border-4 border-[#020617] rounded-full">
                <StatusIcon status={status} active={isActive} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between mb-2 cursor-pointer group" onClick={() => setIsOpen(!isOpen)}>
                <div>
                    <h3 className={clsx("text-lg font-medium transition-colors",
                        isActive ? "text-blue-400 animate-pulse" : isComplete ? "text-slate-200" : "text-slate-600 group-hover:text-slate-400")}>
                        {title}
                    </h3>
                    {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
                </div>
                <div className="flex items-center gap-3">
                    {duration && <span className="text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800">{duration}</span>}
                    {isOpen ? <ChevronUp size={16} className="text-slate-600" /> : <ChevronDown size={16} className="text-slate-600" />}
                </div>
            </div>

            {/* Content Body */}
            <div className={clsx("overflow-hidden transition-all duration-700 ease-in-out", isOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0")}>
                {children}
            </div>
        </div>
    );
};

// --- MAIN COMPONENT ---

const AnalysisDashboard: React.FC<Props> = ({ data, onTypingComplete }) => {
    if (!data || data.stage === AnalysisStage.IDLE) return null;

    const { stage, timings, price, change24h, candles, technicals, deepAnalysis, systemLog, anchorTechnicals, news } = data;

    // Determine Step Statuses
    const getStatus = (targetStage: string): 'PENDING' | 'ACTIVE' | 'COMPLETE' => {
        // ERROR HANDLING: If we are in ERROR stage, everything before or at the error is 'COMPLETE' (failed), 
        // but we'll show the error card separately.
        if (stage === AnalysisStage.ERROR) return 'COMPLETE';

        // If the entire process is complete, everything is COMPLETE. 
        if (stage === AnalysisStage.COMPLETE) return 'COMPLETE';

        const stages = [
            AnalysisStage.FETCHING_DATA,
            AnalysisStage.COMPUTING_TECHNICALS,
            AnalysisStage.AGGREGATING_SIGNALS,
            AnalysisStage.GENERATING_THOUGHTS,
            AnalysisStage.COMPLETE
        ];

        const currentIndex = stages.indexOf(stage);
        const targetIndex = stages.indexOf(targetStage as AnalysisStage);

        if (currentIndex > targetIndex) return 'COMPLETE';
        if (currentIndex === targetIndex) return 'ACTIVE';
        return 'PENDING';
    };

    const formatCurrency = (val: number) => `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formatPct = (val: number) => `${val > 0 ? '+' : ''}${val.toFixed(2)}%`;

    return (
        <div className="max-w-2xl mx-auto py-8 px-4 animate-in fade-in slide-in-from-bottom-4 duration-700">

            {/* HEADER & DIAGNOSTICS */}
            <div className="mb-8 flex items-center justify-between py-4 border-b border-slate-800/50">
                <div>
                    <h1 className="text-2xl font-light tracking-wider text-white">LIVE ANALYSIS</h1>
                    <p className="text-slate-500 text-xs mt-1">AI-Driven Market Intelligence • {data.symbol}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className={clsx("w-2 h-2 rounded-full",
                        stage === AnalysisStage.COMPLETE ? "bg-slate-500" :
                            stage === AnalysisStage.ERROR ? "bg-red-500" : "bg-emerald-500 animate-pulse")} />
                    <span className={clsx("text-xs font-mono",
                        stage === AnalysisStage.COMPLETE ? "text-slate-500" :
                            stage === AnalysisStage.ERROR ? "text-red-500" : "text-emerald-500")}>
                        {stage === AnalysisStage.COMPLETE ? 'COMPLETE' : stage === AnalysisStage.ERROR ? 'FAILED' : 'PROCESSING'}
                    </span>
                </div>
            </div>

            {systemLog && systemLog.length > 0 && <DiagnosticConsole logs={systemLog} />}

            {/* ERROR VIEW */}
            {stage === AnalysisStage.ERROR && (
                <div className="mb-8 p-6 bg-red-950/20 border border-red-900/50 rounded-2xl animate-in fade-in zoom-in duration-500">
                    <div className="flex items-center gap-3 mb-4 text-red-400">
                        <AlertTriangle className="animate-pulse" size={24} />
                        <h2 className="text-xl font-bold uppercase tracking-tight">Protocol Failure</h2>
                    </div>
                    <p className="text-red-200/70 text-sm leading-relaxed mb-4 font-mono">
                        The neural link encountered an interruption during high-frequency data ingestion.
                        Live feeds for <span className="text-red-400 font-bold">{data.symbol}</span> are currently unreachable.
                    </p>
                    <div className="flex gap-4 p-3 bg-red-900/10 rounded-lg border border-red-900/20">
                        <div className="text-[10px] text-red-500/50 uppercase font-bold">System Recommendation</div>
                        <div className="text-xs text-red-300 font-mono italic">Retry analysis in 60s or check exchange connectivity.</div>
                    </div>
                </div>
            )}

            {/* STEP 1: DATA COLLECTION */}
            <AnalysisStep
                title="Data Collection"
                subtitle={`Fetching live market data for ${data.symbol}`}
                status={getStatus(AnalysisStage.FETCHING_DATA)}
                duration={timings.data > 0 ? `${timings.data}s` : undefined}
            >
                <div className="grid grid-cols-2 gap-4 bg-slate-900/30 p-4 rounded-xl border border-slate-800/50">
                    <MetricRow label="Current Price" value={formatCurrency(price)} color="white" />
                    <MetricRow label="24h Change" value={formatPct(change24h)} color={change24h >= 0 ? "emerald" : "red"} />
                    <MetricRow label="Volume 24h" value={technicals ? `${technicals.volume.ratio.toFixed(2)}x Avg` : "..."} subtext="Relative Volume" />
                    <MetricRow label="Market Pulse" value={news.length > 0 ? `${news.length} Headlines` : "Fetching..."} subtext="Social/News Feed" />
                </div>
            </AnalysisStep>

            {/* STEP 2: TECHNICAL ANALYSIS */}
            <AnalysisStep
                title="Technical Analysis"
                subtitle="Computing 25+ technical indicators"
                status={getStatus(AnalysisStage.COMPUTING_TECHNICALS)}
                duration={timings.technicals > 0 ? `${timings.technicals}s` : undefined}
            >
                {technicals && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <IndicatorCard name="RSI" signal={technicals.rsi.signal} value={technicals.rsi.value} strength={technicals.rsi.strength} subtext="Momentum" />
                            <IndicatorCard name="Stochastic" signal={technicals.stoch.signal} value={`${technicals.stoch.k.toFixed(0)}/${technicals.stoch.d.toFixed(0)}`} strength={technicals.stoch.strength} subtext="Oscillator" />
                            <IndicatorCard name="ADX" signal={technicals.adx.signal} value={technicals.adx.value.toFixed(1)} strength={technicals.adx.strength} subtext="Trend Strength" />
                            <IndicatorCard name="ATR" signal="NEUTRAL" value={technicals.atr.value.toFixed(4)} strength={50} subtext="Volatility (Units)" />
                        </div>
                        <DecisionMatrix technicals={technicals} anchorTechnicals={anchorTechnicals} />
                    </div>
                )}
            </AnalysisStep>

            {/* STEP 3: SIGNAL AGGREGATION */}
            <AnalysisStep
                title="Signal Aggregation"
                subtitle="Weighing all signals for optimal confidence"
                status={getStatus(AnalysisStage.AGGREGATING_SIGNALS)}
                duration={timings.aggregation > 0 ? `${timings.aggregation}s` : undefined}
            >
                {technicals && (
                    <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-800/50 space-y-4">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-emerald-400 font-bold">{technicals.summary.upSignals} UP</span>
                            <span className="text-slate-500 font-mono">{technicals.summary.alignment.toFixed(1)}% Alignment</span>
                            <span className="text-red-400 font-bold">{technicals.summary.downSignals} DOWN</span>
                        </div>
                        <div className="flex h-2 rounded-full overflow-hidden w-full bg-slate-800">
                            <div style={{ width: `${(technicals.summary.upScore / (technicals.summary.upScore + technicals.summary.downScore + 1)) * 100}%` }} className="bg-emerald-500 transition-all duration-1000" />
                            <div className="flex-1 bg-red-500 transition-all duration-1000" />
                        </div>

                        {technicals.patterns.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-2">
                                {technicals.patterns.map(p => (
                                    <span key={p} className="text-[10px] font-bold bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20">
                                        {p}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                            <span className="text-xs text-slate-500 uppercase tracking-widest">Market Regime</span>
                            <span className="text-sm font-bold text-blue-400 px-3 py-1 bg-blue-500/10 rounded border border-blue-500/20">
                                {technicals.summary.regime.replace('_', ' ')}
                            </span>
                        </div>

                        <SentinelNewsAudit news={news} />
                    </div>
                )}
            </AnalysisStep>

            {/* STEP 4: AI DEEP ANALYSIS (THOUGHTS) */}
            <AnalysisStep
                title="AI Deep Analysis"
                subtitle="Gemini 3 Pro analyzing market conditions"
                status={getStatus(AnalysisStage.GENERATING_THOUGHTS)}
                duration={timings.ai > 0 ? `${timings.ai}s` : undefined}
            >
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-slate-400 leading-relaxed max-h-[400px] overflow-y-auto relative custom-scrollbar min-h-[100px]">
                    <div className="flex items-center gap-2 mb-4 text-purple-400 pb-2 border-b border-purple-500/20">
                        <Brain size={14} />
                        <span className="uppercase font-bold tracking-widest">Thinking Process (Gemini 3.0)</span>
                    </div>

                    {!deepAnalysis ? (
                        <ThinkingLoader symbol={data.symbol} />
                    ) : (
                        <ThinkingReveal
                            steps={deepAnalysis.thought_process || []}
                            onAllComplete={onTypingComplete}
                        />
                    )}
                </div>
            </AnalysisStep>

            {/* STEP 5: FINAL VERDICT */}
            <AnalysisStep
                title="Final Verdict"
                subtitle="High-confidence prediction"
                status={getStatus(AnalysisStage.COMPLETE)}
                isLast={true}
            >
                {deepAnalysis && (
                    <div className={clsx("p-1 rounded-2xl border transition-all duration-1000 animate-in fade-in zoom-in",
                        deepAnalysis.verdict.direction === 'NEUTRAL' ? "bg-slate-900/50 border-slate-700/50" :
                            "bg-gradient-to-br from-slate-900 to-slate-950 border-slate-800")}>
                        <div className="p-6">
                            {/* Direction & Confidence */}
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Execution Direction</div>
                                    <div className={clsx("text-4xl font-bold tracking-tighter",
                                        deepAnalysis.verdict.direction === 'UP' ? "text-emerald-400" :
                                            deepAnalysis.verdict.direction === 'DOWN' ? "text-red-400" : "text-slate-400")}>
                                        {deepAnalysis.verdict.direction}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Conviction</div>
                                    <div className="text-2xl font-mono text-white opacity-90">{deepAnalysis.verdict.confidence}%</div>
                                </div>
                            </div>

                            {/* Neutral Mode Warning */}
                            {deepAnalysis.verdict.direction === 'NEUTRAL' && (
                                <div className="mb-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl flex gap-3 items-center">
                                    <AlertTriangle className="text-blue-400 shrink-0" size={18} />
                                    <p className="text-xs text-blue-200/70 font-mono italic">
                                        "No actionable trade setup detected. Market symmetry suggests high risk. Standing aside."
                                    </p>
                                </div>
                            )}

                            {/* Summary & Narrative */}
                            <div className="space-y-4 mb-6">
                                <p className="text-slate-300 text-sm leading-relaxed border-l-2 border-slate-700 pl-4">
                                    {deepAnalysis.verdict.summary}
                                </p>

                                {deepAnalysis.verdict.marketNarrative && (
                                    <div className="bg-purple-500/5 p-3 rounded-lg border border-purple-500/10">
                                        <div className="text-[10px] text-purple-400 uppercase font-bold mb-1 tracking-tighter">Market Narrative</div>
                                        <div className="text-xs text-slate-400 font-light italic">{deepAnalysis.verdict.marketNarrative}</div>
                                    </div>
                                )}
                            </div>

                            {/* Targets & R:R */}
                            {deepAnalysis.verdict.targets && deepAnalysis.verdict.direction !== 'NEUTRAL' && (
                                <div className="space-y-4 mb-6">
                                    <div className="grid grid-cols-3 gap-2 bg-slate-950/50 p-3 rounded-xl border border-slate-800/50">
                                        <div className="text-center">
                                            <div className="text-[10px] text-slate-500 uppercase">Entry</div>
                                            <div className="text-sm font-mono text-blue-400">{deepAnalysis.verdict.targets.entry}</div>
                                        </div>
                                        <div className="text-center border-l border-slate-800">
                                            <div className="text-[10px] text-slate-500 uppercase">Target</div>
                                            <div className="text-sm font-mono text-emerald-400">{deepAnalysis.verdict.targets.target}</div>
                                        </div>
                                        <div className="text-center border-l border-slate-800">
                                            <div className="text-[10px] text-slate-500 uppercase">Stop</div>
                                            <div className="text-sm font-mono text-red-400">{deepAnalysis.verdict.targets.stopLoss}</div>
                                        </div>
                                    </div>

                                    {deepAnalysis.verdict.riskReward && (
                                        <div className="flex justify-between items-center px-1">
                                            <span className="text-[10px] text-slate-500 uppercase">Risk:Reward Ratio</span>
                                            <span className="text-xs font-mono text-white">1:{deepAnalysis.verdict.riskReward.ratio}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Chart Area */}
                            <div className="h-40 w-full relative rounded-xl overflow-hidden border border-slate-800/50 bg-slate-900/50 mb-6 group">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data.candles}>
                                        <defs>
                                            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={deepAnalysis.verdict.direction === 'UP' ? '#10b981' : deepAnalysis.verdict.direction === 'DOWN' ? '#ef4444' : '#334155'} stopOpacity={0.2} />
                                                <stop offset="95%" stopColor={deepAnalysis.verdict.direction === 'UP' ? '#10b981' : deepAnalysis.verdict.direction === 'DOWN' ? '#ef4444' : '#334155'} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="time" hide />
                                        <YAxis domain={['auto', 'auto']} hide />

                                        {deepAnalysis.verdict.targets && deepAnalysis.verdict.direction !== 'NEUTRAL' && (
                                            <>
                                                {/* Target Zone */}
                                                <ReferenceArea
                                                    y1={parseFloat(deepAnalysis.verdict.targets.entry.replace(/[^0-9.]/g, ''))}
                                                    y2={parseFloat(deepAnalysis.verdict.targets.target.replace(/[^0-9.]/g, ''))}
                                                    fill={deepAnalysis.verdict.direction === 'UP' ? '#10b981' : '#ef4444'}
                                                    fillOpacity={0.05}
                                                />
                                                {/* Stop Zone */}
                                                <ReferenceArea
                                                    y1={parseFloat(deepAnalysis.verdict.targets.entry.replace(/[^0-9.]/g, ''))}
                                                    y2={parseFloat(deepAnalysis.verdict.targets.stopLoss.replace(/[^0-9.]/g, ''))}
                                                    fill="#ef4444"
                                                    fillOpacity={0.1}
                                                />
                                                {/* Levels */}
                                                <ReferenceLine
                                                    y={parseFloat(deepAnalysis.verdict.targets.target.replace(/[^0-9.]/g, ''))}
                                                    stroke="#10b981"
                                                    strokeDasharray="3 3"
                                                    label={{ value: 'TARGET', position: 'right', fill: '#10b981', fontSize: 8 }}
                                                />
                                                <ReferenceLine
                                                    y={parseFloat(deepAnalysis.verdict.targets.stopLoss.replace(/[^0-9.]/g, ''))}
                                                    stroke="#ef4444"
                                                    strokeDasharray="3 3"
                                                    label={{ value: 'STOP', position: 'right', fill: '#ef4444', fontSize: 8 }}
                                                />
                                                <ReferenceLine
                                                    y={parseFloat(deepAnalysis.verdict.targets.entry.replace(/[^0-9.]/g, ''))}
                                                    stroke="#3b82f6"
                                                    label={{ value: 'ENTRY', position: 'right', fill: '#3b82f6', fontSize: 8 }}
                                                />
                                            </>
                                        )}

                                        <Area
                                            type="monotone"
                                            dataKey="close"
                                            stroke={deepAnalysis.verdict.direction === 'UP' ? '#10b981' : deepAnalysis.verdict.direction === 'DOWN' ? '#ef4444' : '#475569'}
                                            fill="url(#chartGradient)"
                                            strokeWidth={1.5}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/20 to-transparent pointer-events-none" />
                            </div>

                            {/* Factors & Correlation */}
                            <div className="space-y-6 pt-6 border-t border-slate-800/50">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="p-1 rounded bg-emerald-500/10"><TrendingUp size={14} className="text-emerald-400" /></div>
                                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Alpha Factors</span>
                                        </div>
                                        <ul className="space-y-2">
                                            {deepAnalysis.observations.map((obs, i) => (
                                                <li key={i} className="text-[11px] text-slate-400 flex items-start gap-2 leading-snug">
                                                    <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                                                    <span>{obs}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="p-1 rounded bg-amber-500/10"><AlertTriangle size={14} className="text-amber-400" /></div>
                                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Risk Overlay</span>
                                        </div>
                                        <ul className="space-y-2">
                                            {deepAnalysis.risks.map((risk, i) => (
                                                <li key={i} className="text-[11px] text-slate-400 flex items-start gap-2 leading-snug">
                                                    <div className="w-1 h-1 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                                                    <span>{risk}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>

                                {deepAnalysis.verdict.btcCorrelation && (
                                    <div className="flex items-center justify-between text-[10px] text-slate-600 border-t border-slate-800/30 pt-4">
                                        <span className="uppercase tracking-widest font-bold">BTC Correlation Awareness</span>
                                        <span className="italic">{deepAnalysis.verdict.btcCorrelation}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </AnalysisStep>
        </div>
    );
};

export default AnalysisDashboard;