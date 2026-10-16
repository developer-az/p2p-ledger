import { useEffect, useRef, useState } from 'react';

type StationId = 'why' | 'deposit' | 'p2p' | 'reject' | 'ledger' | 'peers';

interface Station {
  id: StationId;
  gx: number;
  gy: number;
  label: string;
  npc?: { name: string; color: string };
  title: string;
  lines: string[];
  action?: string;
}

const STATIONS: Station[] = [
  {
    id: 'why',
    gx: 2,
    gy: 8,
    label: 'START',
    title: 'Why ledger-service?',
    lines: [
      'Apps should not keep their own balances.',
      'One PostgreSQL ledger = auditable truth under concurrency.',
      'This path is the story your hiring manager sees.',
    ],
  },
  {
    id: 'deposit',
    gx: 5,
    gy: 7,
    label: 'BANK',
    npc: { name: 'Funding', color: '#6b7280' },
    title: 'Deposit (SYSTEM → you)',
    lines: [
      'Money enters from a SYSTEM funding account.',
      'Double-entry: credit your USER wallet, debit funding.',
      'Idempotency-Key makes retries safe.',
    ],
    action: 'Try: Send tab → deposit',
  },
  {
    id: 'p2p',
    gx: 8,
    gy: 5,
    label: 'P2P',
    npc: { name: 'Sam', color: '#60a5fa' },
    title: 'Peer-to-peer transfer',
    lines: [
      'USER → USER, no middleman balance in the app server.',
      'Memo is data; fraud rules run in Java before commit.',
      'Completed transfers update both balances atomically.',
    ],
    action: 'Try: Send tab → pick a peer',
  },
  {
    id: 'reject',
    gx: 11,
    gy: 3,
    label: 'FRAUD',
    npc: { name: 'Jordan', color: '#e5a50a' },
    title: 'Rejected payment',
    lines: [
      'Declines are stored — not thrown away.',
      'NEW_ACCOUNT_LARGE_TRANSFER: $12k rent on a young wallet.',
      'VELOCITY_LIMIT: 5 sends in 60 seconds.',
    ],
    action: 'Ask tab: "Why was my rent declined?"',
  },
  {
    id: 'ledger',
    gx: 14,
    gy: 5,
    label: 'BOOK',
    title: 'Append-only ledger entries',
    lines: [
      'Every completed move posts signed lines.',
      'balance_after_minor proves the running total.',
      'Export statement.txt from the Ledger tab.',
    ],
    action: 'Open: Ledger tab',
  },
  {
    id: 'peers',
    gx: 17,
    gy: 8,
    label: 'NET',
    npc: { name: 'Alex', color: '#3dd68c' },
    title: 'P2P network',
    lines: [
      'Peers = counterparties you have paid or received from.',
      'Live wallets use PostgreSQL; practice mirrors the story.',
      'Scale = more accounts, same API — not a second ledger.',
    ],
  },
];

const WALKABLE = new Set<string>();
for (let gy = 2; gy <= 10; gy++) {
  for (let gx = 1; gx <= 18; gx++) {
    if (Math.abs(gx - gy) <= 10) WALKABLE.add(`${gx},${gy}`);
  }
}

function isoToScreen(gx: number, gy: number, tw: number, th: number, ox: number, oy: number) {
  return {
    x: ox + (gx - gy) * (tw / 2),
    y: oy + (gx + gy) * (th / 2),
  };
}

function drawPixelPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  frame: number,
  facing: 'n' | 's' | 'e' | 'w',
) {
  const bob = Math.sin(frame * 0.2) * 2;
  const px = 4;
  ctx.fillStyle = color;
  const bodyY = y - 24 + bob;
  ctx.fillRect(x - px * 2, bodyY, px * 4, px * 5);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(x - px * 2, bodyY - px * 3, px * 4, px * 3);
  ctx.fillStyle = '#1f2937';
  const eye = facing === 'w' ? -px : facing === 'e' ? px : 0;
  ctx.fillRect(x - px + eye, bodyY - px * 2, px, px);
  ctx.fillRect(x + eye, bodyY - px * 2, px, px);
  ctx.fillStyle = color;
  const leg = (frame % 20 < 10) ? 0 : px;
  ctx.fillRect(x - px * 2, bodyY + px * 5, px * 2 - leg, px * 2);
  ctx.fillRect(x, bodyY + px * 5, px * 2 + leg, px * 2);
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const fy = y - 8 - Math.abs(Math.sin(t * 0.1)) * 12;
  ctx.fillStyle = '#e5a50a';
  ctx.beginPath();
  ctx.ellipse(x, fy, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function LedgerWorld({ onJump }: { onJump?: (target: 'send' | 'ledger' | 'ask') => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [player, setPlayer] = useState({ gx: 2, gy: 8 });
  const [facing, setFacing] = useState<'n' | 's' | 'e' | 'w'>('e');
  const [active, setActive] = useState<Station | null>(STATIONS[0] ?? null);
  const [anim, setAnim] = useState(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const posRef = useRef({ gx: 2, gy: 8 });
  const facingRef = useRef<'n' | 's' | 'e' | 'w'>('e');

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const id = window.setInterval(() => {
      const k = keysRef.current;
      const { gx: pgx, gy: pgy } = posRef.current;
      let nx = pgx;
      let ny = pgy;
      let pf = facingRef.current;
      if (k.w || k.arrowup) { ny -= 1; pf = 'n'; }
      if (k.s || k.arrowdown) { ny += 1; pf = 's'; }
      if (k.a || k.arrowleft) { nx -= 1; pf = 'w'; }
      if (k.d || k.arrowright) { nx += 1; pf = 'e'; }
      if (WALKABLE.has(`${nx},${ny}`) && (nx !== pgx || ny !== pgy)) {
        posRef.current = { gx: nx, gy: ny };
        facingRef.current = pf;
        setPlayer({ gx: nx, gy: ny });
        setFacing(pf);
        const hit = STATIONS.find((s) => s.gx === nx && s.gy === ny);
        if (hit) setActive(hit);
      }
      frame++;
      setAnim(frame);
    }, 120);
    return () => window.clearInterval(id);
  }, []);

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
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, w, h);

    const tw = 48;
    const th = 24;
    const ox = w * 0.35;
    const oy = h * 0.12;

    const drawTile = (gx: number, gy: number, fill: string, edge: string) => {
      const { x, y } = isoToScreen(gx, gy, tw, th, ox, oy);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + tw / 2, y + th / 2);
      ctx.lineTo(x, y + th);
      ctx.lineTo(x - tw / 2, y + th / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.stroke();
    };

    for (const key of WALKABLE) {
      const [gxRaw, gyRaw] = key.split(',');
      const gx = Number(gxRaw);
      const gy = Number(gyRaw);
      const near = STATIONS.some((s) => s.gx === gx && s.gy === gy);
      drawTile(gx, gy, near ? '#1a2e1f' : '#141414', near ? '#3dd68c' : '#2e2e2e');
    }

    for (const s of STATIONS) {
      const { x, y } = isoToScreen(s.gx, s.gy, tw, th, ox, oy);
      ctx.fillStyle = '#d4d4d4';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(s.label, x, y - 36);
      if (s.npc) {
        drawPixelPerson(ctx, x + 14, y, s.npc.color, anim + s.gx, 's');
      }
      if (s.id === 'p2p' && active?.id === 'p2p') {
        drawCoin(ctx, x, y - 20, anim);
        drawCoin(ctx, x + 20, y - 28, anim + 5);
      }
      if (s.id === 'reject' && active?.id === 'reject') {
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 10, y - 30);
        ctx.lineTo(x + 10, y - 10);
        ctx.moveTo(x + 10, y - 30);
        ctx.lineTo(x - 10, y - 10);
        ctx.stroke();
      }
    }

    const { x: px, y: py } = isoToScreen(player.gx, player.gy, tw, th, ox, oy);
    drawPixelPerson(ctx, px, py, '#3dd68c', anim, facing);
  }, [player, facing, anim, active]);

  const jumpTarget = active?.action?.includes('Send')
    ? 'send'
    : active?.action?.includes('Ledger')
      ? 'ledger'
      : active?.action?.includes('Ask')
        ? 'ask'
        : null;

  return (
    <section className="pane world-pane">
      <div className="pane-hd">
        <strong>ledger walkthrough</strong> · WASD / arrows · 8-bit isometric
      </div>
      <div className="pane-bd world-layout">
        <canvas ref={canvasRef} className="world-canvas" aria-label="Isometric ledger path" />
        <div className="world-terminal">
          <p className="step-label">{active?.label ?? '···'}</p>
          <strong>{active?.title}</strong>
          {active?.lines.map((line) => (
            <p key={line} className="world-line">{line}</p>
          ))}
          {active?.action && (
            <p className="dim" style={{ fontSize: '11px', marginTop: 8 }}>{active.action}</p>
          )}
          {jumpTarget && onJump && (
            <button type="button" className="t-btn-inline" style={{ marginTop: 10 }} onClick={() => onJump(jumpTarget)}>
              [ open {jumpTarget} tab ]
            </button>
          )}
          <p className="dim" style={{ fontSize: '10px', marginTop: 12 }}>
            Walk to each glowing tile. NPCs play deposit, P2P, fraud reject, and ledger posting.
          </p>
        </div>
      </div>
    </section>
  );
}
