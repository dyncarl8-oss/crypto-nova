import React from 'react';
import { Lock, ExternalLink } from 'lucide-react';

interface MembershipGateProps {
    onJoin?: () => void;
}

export default function MembershipGate({ onJoin }: MembershipGateProps) {
    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
            {/* Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[120px]" />

            <div className="relative z-10 max-w-md w-full bg-slate-900/50 border border-slate-800 backdrop-blur-xl rounded-3xl p-8 text-center shadow-2xl">
                <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
                    <Lock className="text-emerald-500" size={40} />
                </div>

                <h1 className="text-3xl font-bold text-white mb-4 tracking-tight">Access Restricted</h1>

                <p className="text-slate-400 mb-8 leading-relaxed">
                    Quantum-level market analysis is reserved for <span className="text-emerald-400 font-semibold">Nova Quantum</span> members.
                    Join our elite community to unlock Nova's full potential.
                </p>

                <button
                    onClick={() => window.open('https://whop.com/nova-quantum', '_blank')}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-4 px-6 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 group shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                >
                    JOIN NOVA QUANTUM
                    <ExternalLink size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                </button>

                <p className="mt-6 text-[10px] font-mono text-slate-500 uppercase tracking-[0.2em]">
                    Protocol Status: Membership Required
                </p>
            </div>
        </div>
    );
}
