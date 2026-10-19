import type { AccountSummary } from '../api.js';
import type { MoneyPlan } from './money-plan.js';

export interface Milestone {
  id: string;
  title: string;
  body: string;
  emoji: string;
  earned: boolean;
  progress: number;
}

export function milestones(plan: MoneyPlan, summary?: AccountSummary): Milestone[] {
  const patterns = plan.patterns;
  const logCount = patterns?.categories.reduce((total, category) => total + category.count, 0) ?? 0;
  const sentSomething = summary ? summary.sent !== '$0.00' || summary.received !== '$0.00' : false;
  const underPlan = plan.budgetMinor !== null && plan.weekSpentMinor > 0 && plan.weekSpentMinor <= plan.budgetMinor;
  return [
    {
      id: 'first-log',
      title: 'First dot on the map',
      body: 'You logged your first spend.',
      emoji: '🌱',
      earned: logCount > 0,
      progress: logCount > 0 ? 1 : 0,
    },
    {
      id: 'streak-3',
      title: 'Three in a row',
      body: 'A three-day logging streak.',
      emoji: '🔥',
      earned: plan.streakDays >= 3,
      progress: Math.min(1, plan.streakDays / 3),
    },
    {
      id: 'streak-7',
      title: 'A full week of knowing',
      body: 'Seven days without a blind spot.',
      emoji: '🌗',
      earned: plan.streakDays >= 7,
      progress: Math.min(1, plan.streakDays / 7),
    },
    {
      id: 'ten-logs',
      title: 'Patterns are forming',
      body: 'Ten spends logged in the last 30 days.',
      emoji: '🧩',
      earned: logCount >= 10,
      progress: Math.min(1, logCount / 10),
    },
    {
      id: 'under-plan',
      title: 'Kept the pace',
      body: 'A week inside your plan.',
      emoji: '🎯',
      earned: underPlan,
      progress: plan.budgetMinor && plan.budgetMinor > 0 ? Math.min(1, plan.weekSpentMinor / plan.budgetMinor) : 0,
    },
    {
      id: 'first-settle',
      title: 'Settled up',
      body: 'Money moved with a friend.',
      emoji: '🤝',
      earned: sentSomething,
      progress: sentSomething ? 1 : 0,
    },
  ];
}

export function nextMilestone(list: Milestone[]): Milestone | null {
  return list.find((m) => !m.earned) ?? null;
}
