'use client';

import { useRef, useState, useLayoutEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { logger } from '@/lib/logger';

interface WorkoutImageGeneratorProps {
  workout: {
    name: string;
    type: string;
    startTime: Date;
    distance?: number;
    calories?: number;
    duration?: string;
    notes?: string;
  };
}

// Extracted so the same JSX renders in both the preview and the hidden capture target
function CardFace({ workout }: WorkoutImageGeneratorProps) {
  const formatDistance = (m?: number) =>
    m ? (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`) : '—';

  const date = new Date(workout.startTime).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const time = new Date(workout.startTime).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      style={{
        width: '1080px',
        height: '1350px',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#0A0A0A',
        color: '#fff',
        backgroundImage: `
          linear-gradient(45deg, #111 25%, transparent 25%),
          linear-gradient(-45deg, #111 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #111 75%),
          linear-gradient(-45deg, transparent 75%, #111 75%)
        `,
        backgroundSize: '80px 80px',
        backgroundPosition: '0 0, 0 40px, 40px -40px, -40px 0px',
        fontFamily: 'var(--font-space-grotesk), sans-serif',
      }}
    >
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '56px', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ width: '96px', height: '96px', backgroundColor: '#EAB308', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px' }}>
            <img src="/icon-logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} crossOrigin="anonymous" />
          </div>
          <div>
            <div style={{ fontSize: '36px', fontWeight: 900, letterSpacing: '-1px' }}>HYBRIDX.CLUB</div>
            <div style={{ fontSize: '18px', color: '#FACC15', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '4px', marginTop: '4px' }}>Performance Hub</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '28px', fontWeight: 700 }}>{date}</div>
          <div style={{ fontSize: '18px', color: '#6B7280', fontWeight: 500 }}>{time}</div>
        </div>
      </div>

      {/* BADGE */}
      <div style={{ padding: '0 56px', marginTop: '16px', position: 'relative', zIndex: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: '#EAB308', color: '#000', padding: '8px 32px', borderRadius: '999px', fontSize: '22px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.5px' }}>
          {workout.type}
        </span>
      </div>

      {/* TITLE */}
      <div style={{ padding: '0 56px', marginTop: '64px', position: 'relative', zIndex: 10 }}>
        <h1 style={{ fontSize: '140px', lineHeight: 0.85, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-4px', color: '#fff', margin: 0 }}>
          {workout.name}
        </h1>
      </div>

      {/* NOTES */}
      {workout.notes && (
        <div style={{ padding: '0 56px', marginTop: '48px', position: 'relative', zIndex: 10 }}>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderLeft: '8px solid #EAB308', padding: '40px' }}>
            <p style={{ fontSize: '36px', color: '#E5E7EB', fontWeight: 500, lineHeight: 1.5, fontStyle: 'italic', margin: 0 }}>
              "{workout.notes}"
            </p>
          </div>
        </div>
      )}

      {/* STATS — only render cells with real values */}
      {(() => {
        const stats = [
          workout.duration ? { label: 'Duration', value: workout.duration } : null,
          workout.distance ? { label: 'Distance', value: formatDistance(workout.distance) } : null,
          workout.calories ? { label: 'Calories', value: `${workout.calories}` } : null,
        ].filter(Boolean) as { label: string; value: string }[];

        if (stats.length === 0) return null;

        return (
          <div style={{
            position: 'absolute', bottom: '128px', left: 0, width: '100%',
            display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
            borderTop: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.4)'
          }}>
            {stats.map((stat, i) => (
              <div key={stat.label} style={{ padding: '48px', borderRight: i < stats.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
                <div style={{ fontSize: '20px', color: '#EAB308', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '3px' }}>{stat.label}</div>
                <div style={{ fontSize: '64px', fontWeight: 900, marginTop: '16px', whiteSpace: 'nowrap' }}>{stat.value}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* FOOTER */}
      <div style={{ position: 'absolute', bottom: 0, width: '100%', backgroundColor: '#EAB308', color: '#000', padding: '32px 56px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box' }}>
        <div style={{ fontSize: '36px', fontWeight: 900, letterSpacing: '-1px' }}>HYBRIDX.CLUB</div>
        <div style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '3px', textTransform: 'uppercase' }}>Train Hybrid. Race Strong.</div>
      </div>
    </div>
  );
}

export function WorkoutImageGenerator({ workout }: WorkoutImageGeneratorProps) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [scale, setScale] = useState<number | null>(null);

  // Cap preview at 420px wide — compact lightbox style, never fills the screen
  useLayoutEffect(() => {
    const update = () => {
      const maxPreviewWidth = Math.min(window.innerWidth - 48, 420);
      setScale(maxPreviewWidth / 1080);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const generate = async () => {
    if (!captureRef.current) return;
    setGenerating(true);
    try {
      await document.fonts.ready;
      const images = Array.from(captureRef.current.getElementsByTagName('img'));
      await Promise.all(
        images.map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise((res) => { img.onload = res; img.onerror = res; });
        })
      );

      // Loaded here rather than at module scope: html2canvas is ~196KB and is
      // only needed once someone actually generates an image.
      const { default: html2canvas } = await import('html2canvas');

      // Capture the hidden off-screen element — no transforms, full 1080×1350
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#0A0A0A',
        logging: false,
        width: 1080,
        height: 1350,
      });

      const link = document.createElement('a');
      link.download = `hybridx-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
    } catch (err) {
      logger.error('Failed to generate image:', err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      {/* Hidden full-size capture target — off screen, no transforms */}
      <div
        style={{ position: 'fixed', left: '-9999px', top: 0, pointerEvents: 'none', zIndex: -1 }}
        aria-hidden="true"
      >
        <div ref={captureRef}>
          <CardFace workout={workout} />
        </div>
      </div>

      {/* Visible UI */}
      <div className="flex flex-col items-center gap-3 w-full">

        {/* Scaled preview — compact lightbox style */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            width: scale ? `${1080 * scale}px` : '0px',
            height: scale ? `${1350 * scale}px` : '0px',
          }}
        >
          <div style={{ width: '1080px', transformOrigin: 'top left', transform: `scale(${scale ?? 0})` }}>
            <CardFace workout={workout} />
          </div>
        </div>

        <Button
          onClick={generate}
          disabled={generating}
          size="lg"
          className="w-full h-14 bg-yellow-500 text-black hover:bg-yellow-400 text-lg font-black rounded-2xl transition-all active:scale-95"
        >
          {generating ? (
            <><Loader2 className="h-5 w-5 mr-2 animate-spin" />GENERATING IMAGE...</>
          ) : (
            <><Download className="h-5 w-5 mr-2" />DOWNLOAD WORKOUT CARD</>
          )}
        </Button>
      </div>
    </>
  );
}
