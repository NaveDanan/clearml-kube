'use client';

import { Sun, Moon } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';

interface Particle {
  id: number;
  delay: number;
  duration: number;
}

export default function CinematicThemeSwitcher({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  
  // State Management
  const [mounted, setMounted] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  
  // Ref to track toggle button DOM element
  const toggleRef = useRef<HTMLButtonElement>(null);
  
  // Track whether toggle is in checked (dark) or unchecked (light) position
  const isDark = mounted && (theme === 'dark' || resolvedTheme === 'dark');

  // Handle hydration - prevent mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Generate particles with different timing
  const generateParticles = () => {
    const newParticles: Particle[] = [];
    const particleCount = 3; // Multiple layers

    for (let i = 0; i < particleCount; i++) {
      newParticles.push({
        id: i,
        delay: i * 0.1, // Stagger timing
        duration: 0.6 + i * 0.1, // Different durations for depth
      });
    }

    setParticles(newParticles);
    setIsAnimating(true);

    // Clear particles after animation
    setTimeout(() => {
      setIsAnimating(false);
      setParticles([]);
    }, 1000);
  };

  // Toggle handler - switches theme and triggers particles
  const handleToggle = () => {
    generateParticles();
    setTheme(isDark ? 'light' : 'dark');
  };

  // Size mappings
  const sizeMap = {
    sm: {
      trackH: 'h-[46px]',
      trackW: 'w-[82px]',
      thumbH: 'h-[30px]',
      thumbW: 'w-[30px]',
      padding: 'p-[4px]',
      inset: 'inset-[2px]',
      translateX: 36,
      iconSize: 16,
    },
    md: {
      trackH: 'h-[64px]',
      trackW: 'w-[104px]',
      thumbH: 'h-[44px]',
      thumbW: 'w-[44px]',
      padding: 'p-[6px]',
      inset: 'inset-[3px]',
      translateX: 46,
      iconSize: 20,
    },
    lg: {
      trackH: 'h-[80px]',
      trackW: 'w-[128px]',
      thumbH: 'h-[56px]',
      thumbW: 'w-[56px]',
      padding: 'p-[8px]',
      inset: 'inset-[4px]',
      translateX: 56,
      iconSize: 24,
    },
  } as const;

  const s = sizeMap[size || 'md'];

  // Prevent hydration mismatch - show placeholder during SSR
  if (!mounted) {
    return (
      <div className="relative inline-block">
        <div className={`relative flex ${s.trackH} ${s.trackW} items-center rounded-full bg-muted ${s.padding}`} />
      </div>
    );
  }

  return (
    <div className="relative inline-block">
        {/* SVG Filter for Film Grain Texture */}
        <svg className="absolute w-0 h-0">
        <defs>
          {/* Light mode grain - subtle */}
          <filter id="grain-light">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="4"
              result="noise"
            />
            <feColorMatrix
              in="noise"
              type="saturate"
              values="0"
              result="desaturatedNoise"
            />
            <feComponentTransfer in="desaturatedNoise" result="lightGrain">
              <feFuncA type="linear" slope="0.3" />
            </feComponentTransfer>
            <feBlend in="SourceGraphic" in2="lightGrain" mode="overlay" />
          </filter>
          
          {/* Dark mode grain - more visible */}
          <filter id="grain-dark">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="4"
              result="noise"
            />
            <feColorMatrix
              in="noise"
              type="saturate"
              values="0"
              result="desaturatedNoise"
            />
            <feComponentTransfer in="desaturatedNoise" result="darkGrain">
              <feFuncA type="linear" slope="0.5" />
            </feComponentTransfer>
            <feBlend in="SourceGraphic" in2="darkGrain" mode="overlay" />
          </filter>
        </defs>
      </svg>

      {/* Pill-shaped track container */}
      <motion.button
        ref={toggleRef}
        onClick={handleToggle}
        className={`relative flex ${s.trackH} ${s.trackW} items-center rounded-full ${s.padding} transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
        style={{
          // Dynamic background and shadow based on theme
          background: isDark
            ? 'radial-gradient(ellipse at top left, #3a3a3a 0%, #2a2a2a 40%, #1a1a1a 100%)'
            : 'radial-gradient(ellipse at top left, #ffffffff 0%, #f7f7f7 40%, #e5e5e5ff 100%)',
          boxShadow: isDark
            ? `
              inset 5px 5px 12px rgba(0, 0, 0, 0.9),
              inset -5px -5px 12px rgba(90, 90, 90, 0.25),
              inset 8px 8px 16px rgba(0, 0, 0, 0.7),
              inset -8px -8px 16px rgba(110, 110, 110, 0.15),
              inset 0 2px 4px rgba(0, 0, 0, 1),
              inset 0 -2px 4px rgba(90, 90, 90, 0.3),
              inset 0 0 20px rgba(0, 0, 0, 0.6),
              0 1px 1px rgba(255, 255, 255, 0.05),
              0 2px 4px rgba(0, 0, 0, 0.4),
              0 8px 16px rgba(0, 0, 0, 0.4),
              0 16px 32px rgba(0, 0, 0, 0.3),
              0 24px 48px rgba(0, 0, 0, 0.2)
            `
            : `
              inset 5px 5px 12px rgba(160, 160, 160, 0.2),
              inset -5px -5px 12px rgba(255, 255, 255, 1),
              inset 8px 8px 16px rgba(140, 140, 140, 0.25),
              inset -8px -8px 16px rgba(255, 255, 255, 0.9),
              inset 0 2px 4px rgba(160, 160, 160, 0.35),
              inset 0 -2px 4px rgba(255, 255, 255, 1),
              inset 0 0 20px rgba(200, 200, 200, 0.25),
              0 1px 2px rgba(255, 255, 255, 1),
              0 2px 4px rgba(0, 0, 0, 0.08),
              0 8px 16px rgba(0, 0, 0, 0.06),
              0 16px 32px rgba(0, 0, 0, 0.04),
              0 24px 48px rgba(0, 0, 0, 0.03)
            `,
          border: isDark 
            ? '2px solid rgba(80, 80, 80, 0.1)' 
            : '2px solid rgba(210, 210, 210, 0.2)',
          position: 'relative',
        }}
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        role="switch"
        aria-checked={isDark}
        whileTap={{ scale: 0.98 }}
      >
        {/* Deep inner groove/rim effect */}
        <div 
          className={`absolute ${s.inset} rounded-full pointer-events-none`}
          style={{
            boxShadow: isDark
              ? 'inset 0 2px 6px rgba(0, 0, 0, 0.9), inset 0 -1px 3px rgba(90, 90, 90, 0.25)'
              : 'inset 0 2px 6px rgba(140, 140, 140, 0.35), inset 0 -1px 3px rgba(255, 255, 255, 0.8)',
          }}
        />
        
        {/* Multi-layer glossy overlay */}
        <div 
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: isDark
              ? `
                radial-gradient(ellipse at top, rgba(90, 90, 90, 0.12) 0%, transparent 50%),
                linear-gradient(to bottom, rgba(90, 90, 90, 0.15) 0%, transparent 30%, transparent 70%, rgba(0, 0, 0, 0.3) 100%)
              `
              : `
                radial-gradient(ellipse at top, rgba(255, 255, 255, 0.8) 0%, transparent 50%),
                linear-gradient(to bottom, rgba(255, 255, 255, 0.7) 0%, transparent 30%, transparent 70%, rgba(160, 160, 160, 0.12) 100%)
              `,
            mixBlendMode: 'overlay',
          }}
        />
        
        {/* Ambient occlusion effect */}
        <div 
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            boxShadow: isDark
              ? 'inset 0 0 15px rgba(0, 0, 0, 0.5)'
              : 'inset 0 0 15px rgba(160, 160, 160, 0.18)',
          }}
        />
        {/* Background Icons */}
        <div className="absolute inset-0 flex items-center justify-between px-3">
          <Sun size={s.iconSize} className={isDark ? 'text-amber-200/80' : 'text-amber-500'} />
          <Moon size={s.iconSize} className={isDark ? 'text-neutral-200' : 'text-neutral-600'} />
        </div>

        {/* Circular Thumb with Bouncy Spring Physics */}
        <motion.div
          className={`relative z-10 flex ${s.thumbH} ${s.thumbW} items-center justify-center rounded-full overflow-hidden`}
          style={{
            // Neutral grays matching app theme
            background: isDark
              ? 'linear-gradient(145deg, #6a6a6a 0%, #555555 50%, #454545 100%)'
              : 'linear-gradient(145deg, #ffffff 0%, #fefefe 50%, #f8f8f8 100%)',
            boxShadow: isDark
              ? `
                inset 2px 2px 4px rgba(120, 120, 120, 0.3),
                inset -2px -2px 4px rgba(0, 0, 0, 0.8),
                inset 0 1px 1px rgba(255, 255, 255, 0.12),
                0 1px 2px rgba(255, 255, 255, 0.08),
                0 8px 32px rgba(0, 0, 0, 0.6),
                0 4px 12px rgba(0, 0, 0, 0.5),
                0 2px 4px rgba(0, 0, 0, 0.4)
              `
              : `
                inset 2px 2px 4px rgba(200, 200, 200, 0.25),
                inset -2px -2px 4px rgba(255, 255, 255, 1),
                inset 0 1px 2px rgba(255, 255, 255, 1),
                0 1px 2px rgba(255, 255, 255, 1),
                0 8px 32px rgba(0, 0, 0, 0.15),
                0 4px 12px rgba(0, 0, 0, 0.1),
                0 2px 4px rgba(0, 0, 0, 0.06)
              `,
            border: isDark
              ? '2px solid rgba(150, 150, 150, 0.25)'
              : '2px solid rgba(255, 255, 255, 0.9)',
          }}
          animate={{
            x: isDark ? s.translateX : 0,
          }}
          transition={{
            type: 'spring',
            stiffness: 300, // Fast, responsive movement
            damping: 20, // Bouncy feel with slight overshoot
          }}
        >
          {/* Glossy shine overlay on thumb */}
          <div 
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.4) 0%, transparent 40%, rgba(0, 0, 0, 0.1) 100%)',
              mixBlendMode: 'overlay',
            }}
          />
          {/* Particle Layer - expanding circles from center with grainy texture */}
          {isAnimating && particles.map((particle) => (
            <motion.div
              key={particle.id}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <motion.div
                className="absolute rounded-full"
                style={{
                  width: '10px',
                  height: '10px',
                  background: isDark
                    ? 'radial-gradient(circle, rgba(147, 197, 253, 0.5) 0%, rgba(147, 197, 253, 0) 70%)'
                    : 'radial-gradient(circle, rgba(251, 191, 36, 0.7) 0%, rgba(251, 191, 36, 0) 70%)',
                  mixBlendMode: 'normal',
                }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: isDark ? 6 : 8, opacity: [0, 1, 0] }}
                transition={{
                  duration: isDark ? 0.5 : particle.duration,
                  delay: particle.delay,
                  ease: 'easeOut',
                }}
              >
                {/* Grainy texture overlay */}
                <div 
                  className="absolute inset-0 rounded-full opacity-40"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                    mixBlendMode: 'overlay',
                  }}
                />
              </motion.div>
            </motion.div>
          ))}

          {/* Icon */}
          <div className="relative z-10">
            {isDark ? (
              <Moon size={20} className="text-yellow-200" />
            ) : (
              <Sun size={20} className="text-amber-500" />
            )}
          </div>
        </motion.div>
      </motion.button>
    </div>
  );
}
