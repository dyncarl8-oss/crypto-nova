import React, { useState, useEffect } from 'react';

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'];
const TYPING_SPEED = 100;
const DELETING_SPEED = 50;
const PAUSE_DURATION = 2000;

export default function TypewriterHint() {
    const [text, setText] = useState('');
    const [symbolIndex, setSymbolIndex] = useState(0);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        const currentSymbol = SYMBOLS[symbolIndex];

        const handleTyping = () => {
            if (!isDeleting) {
                // Typing
                if (text.length < currentSymbol.length) {
                    setText(currentSymbol.slice(0, text.length + 1));
                } else {
                    // Finished typing, pause
                    setTimeout(() => setIsDeleting(true), PAUSE_DURATION);
                }
            } else {
                // Deleting
                if (text.length > 0) {
                    setText(text.slice(0, text.length - 1));
                } else {
                    // Finished deleting, move to next
                    setIsDeleting(false);
                    setSymbolIndex((prev) => (prev + 1) % SYMBOLS.length);
                }
            }
        };

        const speed = isDeleting ? DELETING_SPEED : TYPING_SPEED;
        const timeout = setTimeout(handleTyping, speed);

        return () => clearTimeout(timeout);
    }, [text, isDeleting, symbolIndex]);

    return (
        <div className="text-sm font-light text-slate-400 opacity-60 tracking-wide font-mono text-center">
            Ask Nova to Analyze <span className="text-emerald-500 font-bold">{text}</span>
            <span className="animate-pulse ml-0.5 text-emerald-500">_</span>
        </div>
    );
}
