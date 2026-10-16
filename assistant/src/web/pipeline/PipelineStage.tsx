import { useEffect, useRef } from 'react';
import type { CastId } from './isometric-sprites.js';
import {
  drawDeskRoom,
  drawIsoPerson,
  drawP2PArrow,
  drawPipelineStation,
} from './isometric-sprites.js';
import type { PipelineScene } from './pipeline-script.js';

export interface StageActor {
  cast: CastId;
  x: number;
}

export interface PipelineStageProps {
  scene: PipelineScene;
  actors?: StageActor[];
  animTick?: number;
  proofCaption?: string;
}

const STATION_X = [0.08, 0.24, 0.4, 0.56, 0.72];

export function PipelineStage({ scene, actors = [], animTick = 0, proofCaption }: PipelineStageProps) {
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
    ctx.fillStyle = '#12100e';
    ctx.fillRect(0, 0, w, h);
    drawDeskRoom(ctx, w, h);
    const baseY = h * 0.52;
    for (const actor of actors) {
      drawIsoPerson(ctx, actor.cast, actor.x, baseY, 2);
    }
    scene.steps.forEach((step, i) => {
      const x = w * (STATION_X[i] ?? 0.1);
      drawPipelineStation(ctx, x, h * 0.12, step.label, step.state);
    });
    if (scene.fromOwner && scene.toOwner && scene.layout === 'p2p') {
      const t = (animTick % 80) / 80;
      drawP2PArrow(ctx, w * 0.28, w * 0.62, baseY - 20, t);
      ctx.fillStyle = '#a3a3a3';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`${scene.fromOwner} → ${scene.toOwner}`, w * 0.22, baseY + 36);
      if (scene.amountMinor) {
        ctx.fillText(`$${(scene.amountMinor / 100).toFixed(2)} · integer cents`, w * 0.22, baseY + 50);
      }
    }
    if (scene.layout === 'deposit' && scene.fromOwner) {
      ctx.fillStyle = '#a3a3a3';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`${scene.fromOwner} → ${scene.toOwner ?? 'USER'}`, w * 0.22, baseY + 36);
    }
    if (scene.declineCode) {
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillText(`DECLINED · ${scene.declineCode}`, w * 0.22, h * 0.34);
    }
  }, [scene, actors, animTick]);

  return (
    <div className="pipeline-stage-wrap">
      <canvas ref={canvasRef} className="pipeline-stage-canvas" aria-hidden="true" />
      {proofCaption && <p className="pipeline-proof mono small muted">{proofCaption}</p>}
    </div>
  );
}
