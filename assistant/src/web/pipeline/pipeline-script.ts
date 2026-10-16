import type { PaymentTrail } from '../api.js';

export type PipelineStationId =
  | 'idempotency'
  | 'lock'
  | 'fraud'
  | 'postLegs'
  | 'outbox';

export interface PipelineStep {
  station: PipelineStationId;
  state: 'idle' | 'active' | 'done' | 'blocked';
  label: string;
}

export interface PipelineScene {
  layout: 'hook' | 'deposit' | 'p2p' | 'reject' | 'ledger' | 'analytics' | 'handoff';
  fromOwner?: string;
  toOwner?: string;
  fromId?: string;
  toId?: string;
  amountMinor?: number;
  declineCode?: string;
  steps: PipelineStep[];
}

const STATIONS: PipelineStationId[] = ['idempotency', 'lock', 'fraud', 'postLegs', 'outbox'];

function stepsThrough(
  lastActive: PipelineStationId,
  blockedAt?: PipelineStationId,
): PipelineStep[] {
  const labels: Record<PipelineStationId, string> = {
    idempotency: 'Idempotency key',
    lock: 'Lock accounts',
    fraud: 'Fraud rules',
    postLegs: 'Post double-entry',
    outbox: 'Outbox event',
  };
  const lastIdx = STATIONS.indexOf(lastActive);
  const blockIdx = blockedAt ? STATIONS.indexOf(blockedAt) : -1;
  return STATIONS.map((station, i) => {
    let state: PipelineStep['state'] = 'idle';
    if (blockedAt && station === blockedAt) state = 'blocked';
    else if (i < lastIdx) state = 'done';
    else if (i === lastIdx) state = blockedAt ? 'blocked' : 'active';
    else if (i < blockIdx) state = 'done';
    return { station, state, label: labels[station] };
  });
}

export function sceneScriptForLayout(layout: PipelineScene['layout']): PipelineScene {
  switch (layout) {
    case 'deposit':
      return {
        layout,
        fromOwner: 'SYSTEM funding',
        toOwner: 'alex',
        steps: stepsThrough('postLegs'),
      };
    case 'p2p':
      return {
        layout,
        fromOwner: 'alex',
        toOwner: 'sam',
        amountMinor: 2500,
        steps: stepsThrough('outbox'),
      };
    case 'reject':
      return {
        layout,
        fromOwner: 'alex',
        toOwner: 'jordan',
        amountMinor: 1_200_000,
        declineCode: 'NEW_ACCOUNT_LARGE_TRANSFER',
        steps: stepsThrough('fraud', 'fraud'),
      };
    case 'ledger':
      return {
        layout,
        steps: stepsThrough('postLegs'),
      };
    case 'analytics':
      return {
        layout,
        steps: stepsThrough('outbox'),
      };
    case 'handoff':
      return {
        layout,
        steps: stepsThrough('idempotency'),
      };
    default:
      return {
        layout: 'hook',
        steps: stepsThrough('idempotency'),
      };
  }
}

export function mapTrailToPipelineSteps(trail: PaymentTrail): PipelineScene {
  const declined = trail.status === 'REJECTED';
  const steps = declined
    ? stepsThrough('fraud', 'fraud')
    : trail.legs.length > 0
      ? stepsThrough('outbox')
      : stepsThrough('fraud', 'fraud');
  return {
    layout: trail.kind === 'DEPOSIT' ? 'deposit' : declined ? 'reject' : 'p2p',
    fromOwner: trail.from,
    toOwner: trail.to,
    declineCode: trail.decline?.code,
    steps,
  };
}
