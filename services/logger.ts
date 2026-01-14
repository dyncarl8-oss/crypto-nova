export async function serverLog(level: 'info' | 'warn' | 'error', message: string) {
    try {
        // Send to Vite terminal logger
        await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level, message })
        });
    } catch (e) {
        // Fallback to console if server is unreachable
        console.log(`[Fallback] ${level}: ${message}`);
    }
}
