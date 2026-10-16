import { useEffect, useRef } from 'react';
import { drawCharacter, type Pose } from './sprites.js';

export type StageLayout =
  | 'hook'
  | 'deposit'
  | 'p2p'
  | 'reject'
  | 'ledger'
  | 'analytics'
  | 'retry'
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

function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, tick: number) {
  for (let i = 0; i < 28; i++) {
    const sx = ((i * 47) % 100) / 100 * w;
    const sy = ((i * 83) % 55) / 100 * h * 0.65;
    const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(tick * 0.07 + i));
    ctx.fillStyle = `rgba(61, 214, 140, ${twinkle * 0.35})`;
    ctx.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
  }
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number, color: string) {
  const pulse = 0.5 + Math.sin(tick * 0.2) * 0.5;
  ctx.fillStyle = color;
  ctx.globalAlpha = pulse;
  ctx.fillRect(x, y, 2, 2);
  ctx.fillRect(x + 4, y - 2, 2, 2);
  ctx.fillRect(x - 3, y + 3, 2, 2);
  ctx.globalAlpha = 1;
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

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a0a0a');
    grad.addColorStop(1, '#050505');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    drawStars(ctx, w, h, animTick);

    ctx.fillStyle = '#141414';
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.strokeStyle = '#2e2e2e';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72);
    ctx.lineTo(w, h * 0.72);
    ctx.stroke();

    const scale = 3;
    const baseY = h * 0.72 - 22 * scale;

    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i]!;
      const phase = animTick + i * 17;
      drawCharacter(ctx, actor.cast, actor.pose, actor.x, baseY + actor.y, scale, phase);
    }

    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = '#737373';
    if (layout === 'deposit') {
      const cx = w * 0.2 + Math.sin(animTick * 0.08) * 10;
      ctx.fillStyle = '#e5a50a';
      ctx.beginPath();
      ctx.ellipse(cx, baseY - 20, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      drawSparkle(ctx, cx + 12, baseY - 28, animTick, '#3dd68c');
      ctx.fillStyle = '#737373';
      ctx.fillText('FUNDING', w * 0.12, baseY - 32);
    }
    if (layout === 'p2p') {
      const t = (animTick % 50) / 50;
      const x0 = w * 0.35;
      const x1 = w * 0.65;
      const coinX = x0 + (x1 - x0) * t;
      const arc = Math.sin(t * Math.PI) * 18;
      ctx.fillStyle = '#e5a50a';
      ctx.beginPath();
      ctx.ellipse(coinX, baseY - 24 - arc, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      if (t > 0.85) drawSparkle(ctx, x1, baseY - 30, animTick, '#3dd68c');
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
      const bookX = w * 0.58;
      ctx.fillRect(bookX, baseY - 55, 64, 48);
      ctx.strokeRect(bookX, baseY - 55, 64, 48);
      ctx.fillStyle = '#3dd68c';
      for (let i = 0; i < 4; i++) {
        const lineW = 40 + Math.sin(animTick * 0.05 + i) * 4;
        ctx.fillRect(bookX + 8, baseY - 48 + i * 10, lineW, 2);
      }
    }
    if (layout === 'analytics') {
      const bx = w * 0.55;
      const by = baseY - 10;
      const heights = [24, 40, 18, 32];
      heights.forEach((ht, i) => {
        const grow = 1 + Math.sin(animTick * 0.08 + i) * 0.08;
        ctx.fillStyle = i === 1 ? '#3dd68c' : '#2e4a3a';
        ctx.fillRect(bx + i * 14, by - ht * grow, 10, ht * grow);
      });
    }
    if (layout === 'retry') {
      const key = w * 0.48;
      ctx.fillStyle = '#3dd68c';
      ctx.fillText('Idempotency-Key', key - 40, baseY - 58);
      for (let i = 0; i < 5; i++) {
        const offset = (animTick * 2 + i * 14) % 80;
        const px = w * 0.25 + i * (w * 0.12);
        ctx.globalAlpha = 0.35 + (i === Math.floor((animTick / 10) % 5) ? 0.55 : 0);
        ctx.fillStyle = '#e5a50a';
        ctx.beginPath();
        ctx.ellipse(px + offset * 0.15, baseY - 36 - Math.sin(offset * 0.1) * 6, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#737373';
      ctx.fillText('5× same request', w * 0.38, baseY - 18);
    }
    if (layout === 'handoff') {
      drawSparkle(ctx, w * 0.5, baseY - 60, animTick, '#3dd68c');
      drawSparkle(ctx, w * 0.62, baseY - 48, animTick + 8, '#e5a50a');
    }

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, 6);
  }, [layout, actors, animTick]);

  return (
    <canvas
      ref={canvasRef}
      className="pixel-stage-canvas"
      aria-hidden="true"
    />
  );
}
