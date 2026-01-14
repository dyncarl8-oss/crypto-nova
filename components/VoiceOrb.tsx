import React, { useEffect, useRef } from 'react';

interface VoiceOrbProps {
  state: 'listening' | 'speaking' | 'thinking' | 'idle';
  volume: number; // 0 to 1
}

const VoiceOrb: React.FC<VoiceOrbProps> = ({ state, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    // Responsive Canvas Handling
    const resize = () => {
        const parent = canvas.parentElement;
        if (parent) {
            canvas.width = parent.clientWidth;
            canvas.height = parent.clientHeight;
        }
    };
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      time += 0.05;
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = Math.min(width, height) * 0.25; // Responsive radius

      ctx.clearRect(0, 0, width, height);

      // Core Color
      let color = '100, 116, 139'; // slate-500 neutral
      if (state === 'listening') color = '56, 189, 248'; // sky-400
      if (state === 'speaking') color = '74, 222, 128'; // green-400
      if (state === 'thinking') color = '168, 85, 247'; // purple-500

      // Dynamic Radius based on volume
      const dynamicRadius = baseRadius + (volume * (baseRadius * 0.5));

      // Glow effect
      const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.5, centerX, centerY, dynamicRadius * 1.5);
      gradient.addColorStop(0, `rgba(${color}, 0.8)`);
      gradient.addColorStop(0.5, `rgba(${color}, 0.2)`);
      gradient.addColorStop(1, `rgba(${color}, 0)`);

      ctx.beginPath();
      ctx.arc(centerX, centerY, dynamicRadius * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Inner Core
      ctx.beginPath();
      // Breathing effect for thinking
      const breath = state === 'thinking' ? Math.sin(time) * (baseRadius * 0.1) : 0;
      ctx.arc(centerX, centerY, baseRadius + breath, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color}, 0.9)`;
      ctx.shadowBlur = 20;
      ctx.shadowColor = `rgba(${color}, 1)`;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Ripple rings for Speaking
      if (state === 'speaking') {
        for (let i = 0; i < 3; i++) {
          const ringRadius = baseRadius + ((time * 20 + i * 30) % 60);
          const opacity = 1 - (ringRadius - baseRadius) / 60;
          if (opacity > 0) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${color}, ${opacity})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }
      
      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
        window.removeEventListener('resize', resize);
        cancelAnimationFrame(animationId);
    };
  }, [state, volume]);

  return (
    <div className="w-full h-full flex items-center justify-center relative">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
};

export default VoiceOrb;