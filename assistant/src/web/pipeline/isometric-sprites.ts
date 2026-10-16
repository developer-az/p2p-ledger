/** Isometric home-office diorama — warm desk scene + pipeline stations */

export type CastId = 'alex' | 'sam' | 'jordan' | 'clerk';

const CAST_COLOR: Record<CastId, { suit: string; skin: string; hair: string }> = {
  alex: { suit: '#1e3a5f', skin: '#c68642', hair: '#1a1208' },
  sam: { suit: '#4b5563', skin: '#e0b88a', hair: '#4a3728' },
  jordan: { suit: '#374151', skin: '#8d5524', hair: '#0f0f0f' },
  clerk: { suit: '#6b7280', skin: '#d4a574', hair: '#2d2d2d' },
};

export function drawDeskRoom(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const floorY = h * 0.78;
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(0, floorY, w, h - floorY);
  ctx.fillStyle = '#2a2218';
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(w, floorY - 12);
  ctx.lineTo(w, floorY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3d3428';
  ctx.fillRect(w * 0.15, floorY - 48, w * 0.7, 14);
  ctx.fillStyle = '#4a4034';
  ctx.fillRect(w * 0.2, floorY - 52, w * 0.55, 8);
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(w * 0.62, floorY - 70, 36, 22);
  ctx.fillStyle = '#3dd68c';
  ctx.font = '7px ui-monospace, monospace';
  ctx.fillText('ledger', w * 0.63, floorY - 56);
}

export function drawIsoPerson(
  ctx: CanvasRenderingContext2D,
  cast: CastId,
  x: number,
  y: number,
  scale: number,
): void {
  const p = CAST_COLOR[cast];
  const s = scale;
  ctx.fillStyle = p.hair;
  ctx.fillRect(x, y, 6 * s, 3 * s);
  ctx.fillStyle = p.skin;
  ctx.fillRect(x + s, y + 3 * s, 4 * s, 4 * s);
  ctx.fillStyle = p.suit;
  ctx.fillRect(x - s, y + 7 * s, 8 * s, 8 * s);
  ctx.fillStyle = '#111';
  ctx.fillRect(x, y + 15 * s, 2 * s, 4 * s);
  ctx.fillRect(x + 4 * s, y + 15 * s, 2 * s, 4 * s);
}

export function drawPipelineStation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  state: 'idle' | 'active' | 'done' | 'blocked',
): void {
  const colors = {
    idle: '#2e2e2e',
    active: '#3dd68c',
    done: '#2e4a3a',
    blocked: '#f87171',
  };
  ctx.fillStyle = colors[state];
  ctx.fillRect(x, y, 44, 28);
  ctx.strokeStyle = '#525252';
  ctx.strokeRect(x, y, 44, 28);
  ctx.fillStyle = '#e5e5e5';
  ctx.font = '8px ui-monospace, monospace';
  const words = label.split(' ');
  ctx.fillText(words[0] ?? '', x + 4, y + 12);
  ctx.fillText(words.slice(1).join(' ') || '', x + 4, y + 22);
}

export function drawP2PArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  t: number,
): void {
  const cx = x0 + (x1 - x0) * t;
  ctx.strokeStyle = '#e5a50a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.fillStyle = '#e5a50a';
  ctx.beginPath();
  ctx.ellipse(cx, y - 8, 8, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}
