import { useEffect, useRef } from 'react';
import { drawCharacter, type Pose } from './sprites.js';

export type StageLayout =
  | 'hook'
  | 'deposit'
  | 'p2p'
  | 'reject'
  | 'ledger'
  | 'analytics'
  | 'handoff';

export interface StageActor {
  cast: 'alex' | 'sam' | 'jordan' | 'clerk';
  pose: Pose;
  x: number;
  y: number;
}

export interface PixelStageProps {
  layout: StageLayout;
  actors: StageActor[];
  animTick?: number;
}

export function PixelStage({ layout, actors, animTick = 0 }: PixelStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // floor strip
    ctx.fillStyle = '#181818';
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.strokeStyle = '#2e2e2e';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72);
    ctx.lineTo(w, h * 0.72);
    ctx.stroke();

    const scale = 3;
    const baseY = h * 0.72 - 22 * scale;

    for (const actor of actors) {
      drawCharacter(ctx, actor.cast, actor.pose, actor.x, baseY + actor.y, scale);
    }

    // layout props
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = '#737373';
    if (layout === 'deposit') {
      ctx.fillStyle = '#e5a50a';
      const cx = w * 0.2 + Math.sin(animTick * 0.08) * 8;
      ctx.beginPath();
      ctx.ellipse(cx, baseY - 20, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#737373';
      ctx.fillText('FUNDING', w * 0.12, baseY - 32);
    }
    if (layout === 'p2p') {
      const t = (animTick % 60) / 60;
      const x0 = w * 0.35;
      const x1 = w * 0.65;
      const coinX = x0 + (x1 - x0) * t;
      ctx.fillStyle = '#e5a50a';
      ctx.beginPath();
      ctx.ellipse(coinX, baseY - 24, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (layout === 'reject') {
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      const pulse = 0.85 + Math.sin(animTick * 0.1) * 0.15;
      ctx.globalAlpha = pulse;
      ctx.strokeRect(w * 0.55, baseY - 50, 72, 28);
      ctx.fillStyle = '#f87171';
      ctx.fillText('DECLINED', w * 0.57, baseY - 32);
      ctx.globalAlpha = 1;
    }
    if (layout === 'ledger') {
      ctx.fillStyle = '#1a1a1a';
      ctx.strokeStyle = '#3dd68c';
      ctx.fillRect(w * 0.58, baseY - 55, 64, 48);
      ctx.strokeRect(w * 0.58, baseY - 55, 64, 48);
      ctx.fillStyle = '#3dd68c';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(w * 0.6, baseY - 48 + i * 10, 48, 2);
      }
    }
    if (layout === 'analytics') {
      const bx = w * 0.55;
      const by = baseY - 10;
      const heights = [24, 40, 18, 32];
      heights.forEach((ht, i) => {
        ctx.fillStyle = i === 1 ? '#3dd68c' : '#2e4a3a';
        ctx.fillRect(bx + i * 14, by - ht, 10, ht);
      });
    }
  }, [layout, actors, animTick]);

  return <canvas ref={canvasRef} className="pixel-stage-canvas" aria-hidden="true" />;
}
