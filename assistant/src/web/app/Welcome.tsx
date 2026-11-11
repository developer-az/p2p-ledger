import { useEffect, useRef, useState } from 'react';
import { api, type AccountRef, type BootstrapResponse, type PatternDay } from '../api.js';
import { PRACTICE_ANTHONY_ID } from '../practice-fixture.js';
import { BrandMark } from './BrandMark.js';
import { categoryLabel } from './categories.js';
import { money } from './format.js';
import { landingFigures, type LandingFigures } from './landing-figures.js';
import { navigate, routeHref } from './router.js';
import type { Session } from './session.js';
import './styles/landing.css';

const REPO = 'https://github.com/developer-az/p2p-ledger';
const DASH = '—';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const TICKER_MS = 600;
/** Degrees either side of zero the minute track turns as the hero crosses the viewport. */
const DIAL_SWING = 30;

/** True when the visitor asked for less motion. Safe without a window. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION).matches;
}

/**
 * Counts every [data-count-to] element in `root` from zero once, easeOutCubic
 * over 600ms, writing textContent directly so React never re-renders per frame.
 * The last frame writes the server-rendered string, so the final value is exact.
 */
function countUp(root: HTMLElement): () => void {
  const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-count-to]'));
  if (targets.length === 0) return () => {};
  const rows = targets.map((el) => ({
    el,
    to: Number(el.dataset.countTo),
    final: el.dataset.countFinal ?? el.textContent ?? '',
    isMoney: el.dataset.countKind === 'money',
  }));
  const start = performance.now();
  let pending = 0;
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / TICKER_MS);
    const eased = 1 - (1 - t) ** 3;
    for (const row of rows) {
      if (t === 1) {
        row.el.textContent = row.final;
        continue;
      }
      const value = Math.round(row.to * eased);
      row.el.textContent = row.isMoney ? money(value) : String(value);
    }
    if (t < 1) pending = requestAnimationFrame(frame);
  };
  pending = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(pending);
}

/** The five pipeline stages, in the order the diagram draws them. */
const STAGES = [
  {
    n: 1,
    name: 'Import',
    status: 'Partial · M3',
    planned: false,
    body: 'CSV import of spend logs works for connected accounts. Bank statement parsing arrives in M3.',
  },
  {
    n: 2,
    name: 'Reconcile',
    status: 'Planned · M3',
    planned: true,
    body: 'Statement balances checked against the ledger, row by row.',
  },
  {
    n: 3,
    name: 'Resolve',
    status: 'Planned · M4',
    planned: true,
    body: 'Messy card descriptors matched to a canonical merchant with a confidence score.',
  },
  {
    n: 4,
    name: 'Detect',
    status: 'Partial · M5',
    planned: false,
    body: 'Spending patterns by day, week and category work today. Subscriptions arrive in M5 and anomaly reasons in M6.',
  },
  {
    n: 5,
    name: 'Forecast',
    status: 'Planned · M6',
    planned: true,
    body: 'A cash-flow forecast with a P10–P90 band.',
  },
];

/** Geometry of the pipeline diagram: five 168-wide boxes on a 1000-wide canvas. */
const BOX_W = 168;
const BOX_GAP = 30;
const boxX = (index: number) => 20 + index * (BOX_W + BOX_GAP);

/** Geometry of the daily-spend strip: 30 slots of 10, a 4-wide bar in each. */
const DAY_SLOT = 10;
const DAY_BAR = 4;
/** Plot area in viewBox units; the chart adds 8 units below the baseline for its hairline. */
const DAY_PLOT_H = 96;
const CHART_H = 104;

export function Welcome({
  boot,
  bootError,
  onStart,
}: {
  boot: BootstrapResponse | null;
  bootError: string | null;
  onStart: (session: Session) => void;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const dialRef = useRef<HTMLDivElement | null>(null);
  const figsRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<'demo' | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [figures, setFigures] = useState<LandingFigures | null>(null);
  const [days, setDays] = useState<PatternDay[] | null>(null);

  const signinHref = routeHref({ kind: 'signin' });
  const practiceId = boot?.practice.focusAccountId ?? PRACTICE_ANTHONY_ID;

  /** Plain left clicks change the route in place; modified clicks keep the href. */
  const openSignin = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    navigate({ kind: 'signin' });
  };

  // Old links sent OAuth failures to the landing page with ?authError=…; the
  // sign-in page now owns that message, so forward the query and replace history.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { search } = window.location;
    if (!new URLSearchParams(search).get('authError')) return;
    navigate({ kind: 'signin' }, { replace: true, search });
  }, []);

  // Scroll reveals: one observer sets data-in on each section once and the fade
  // lives in landing.css. Sections already on screen are marked before the
  // hiding class lands, so nothing that is visible ever blinks out.
  useEffect(() => {
    const root = pageRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>('.lp-section'));
    if (sections.length === 0) return;
    const fold = window.innerHeight;
    for (const section of sections) {
      if (section.getBoundingClientRect().top < fold) section.dataset.in = 'true';
    }
    document.documentElement.classList.add('js-reveal');

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.in = 'true';
        observer.unobserve(entry.target);
      }
    }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
    for (const section of sections) {
      if (section.dataset.in !== 'true') observer.observe(section);
    }

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('js-reveal');
    };
  }, []);

  // The hero dial is the set piece: the rosette turns on its own in CSS, the
  // minute track counter-rotates with scroll. One rAF-throttled passive
  // listener exists only while the dial is on screen, and it writes a single
  // custom property on the dial itself (never on html or body).
  useEffect(() => {
    const dial = dialRef.current;
    if (!dial || typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) return;

    let frame = 0;
    const write = () => {
      frame = 0;
      const rect = dial.getBoundingClientRect();
      const span = window.innerHeight + rect.height;
      const progress = span > 0 ? Math.min(1, Math.max(0, (window.innerHeight - rect.top) / span)) : 0.5;
      dial.style.setProperty('--dial-turn', ((progress - 0.5) * 2 * DIAL_SWING).toFixed(2));
    };
    const onScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(write);
    };
    const stop = () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const observer = new IntersectionObserver((entries) => {
      const onScreen = entries.some((entry) => entry.isIntersecting);
      dial.classList.toggle('is-paused', !onScreen);
      if (!onScreen) {
        stop();
        return;
      }
      write();
      window.addEventListener('scroll', onScroll, { passive: true });
    }, { threshold: 0 });
    observer.observe(dial);

    return () => {
      observer.disconnect();
      stop();
    };
  }, []);

  // The figure strip counts up once, when it first comes into view. No React
  // state changes here: countUp writes textContent directly.
  useEffect(() => {
    const strip = figsRef.current;
    if (!figures || !strip) return;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) return;
    let cancels: Array<() => void> = [];
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      cancels.push(countUp(strip));
    }, { threshold: 0.35 });
    observer.observe(strip);
    return () => {
      observer.disconnect();
      for (const cancel of cancels) cancel();
      cancels = [];
    };
  }, [figures]);

  // The figures come from the sample household, which the server seeds on read.
  // Reading it here keeps the page static in markup and avoids a layout shift:
  // the cells hold their height and show an em dash until the numbers arrive.
  useEffect(() => {
    let cancelled = false;
    setFigures(null);
    setDays(null);
    api.account(practiceId)
      .then((view) => {
        if (cancelled) return;
        setFigures(landingFigures(view));
        setDays(view.patterns?.days ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setFigures(null);
        setDays(null);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  async function tryDemo() {
    if (!boot) return;
    setBusy('demo');
    setDemoError(null);
    try {
      // The sample household is always the practice household, even when the
      // live ledger is up. Seeding it through POST /api/demo used to create
      // real accounts in PostgreSQL, and since wallet routes started requiring
      // the owning sign-in session (commit 9709d6e), those unsigned demo
      // accounts were then rejected with 401 on every wallet read — the demo
      // opened, then immediately failed to load. Practice accounts are
      // explicitly exempt from that check, and they never touch the real
      // ledger. POST /api/demo stays for the /ops console only.
      let accounts: AccountRef[];
      let focusId: string;
      try {
        const seeded = await api.seedPracticeDemo();
        accounts = seeded.accounts;
        focusId = seeded.focusAccountId;
      } catch {
        accounts = boot.practice.accounts.map(({ id, owner }) => ({ id, owner }));
        focusId = boot.practice.focusAccountId;
      }
      const account = accounts.find((a) => a.id === focusId) ?? accounts[0];
      if (!account) throw new Error('No practice wallets are available.');
      onStart({ account, household: accounts, demo: true });
    } catch (e) {
      setDemoError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // The view can carry more than a month of days; the strip only has 30 slots.
  const chartDays = (days ?? []).slice(-30);
  const totalSpend = chartDays.reduce((sum, day) => sum + day.spendMinor, 0);
  const chartMax = Math.max(1, ...chartDays.map((day) => day.spendMinor));
  const chartLabel = days
    ? `Daily spend for the sample household over the last 30 days, totaling ${money(totalSpend)}.`
    : 'Daily spend for the sample household over the last 30 days.';
  const exploreLabel = busy === 'demo' ? 'Opening the sample…' : 'Explore the sample household';
  const exploreDisabled = !boot || busy !== null;

  const cells = [
    {
      label: 'Rows',
      value: figures ? String(figures.rows) : DASH,
      count: figures ? { to: figures.rows, kind: 'int' as const } : undefined,
    },
    {
      label: 'Distinct descriptions',
      value: figures ? String(figures.payees) : DASH,
      count: figures ? { to: figures.payees, kind: 'int' as const } : undefined,
    },
    {
      label: 'Categories',
      value: figures ? String(figures.categories) : DASH,
      count: figures ? { to: figures.categories, kind: 'int' as const } : undefined,
    },
    {
      label: 'Days of history',
      value: figures ? String(figures.daysOfHistory) : DASH,
      count: figures ? { to: figures.daysOfHistory, kind: 'int' as const } : undefined,
    },
    {
      label: 'Spent, last 30 days',
      value: figures ? money(figures.spend30dMinor) : DASH,
      count: figures ? { to: figures.spend30dMinor, kind: 'money' as const } : undefined,
    },
  ];

  return (
    <div className="lp" ref={pageRef}>
      <header className="lp-header">
        <a className="lp-brand" href="/" aria-label="Settle home">
          <BrandMark size={20} />
          <span>Settle</span>
        </a>
        <nav className="lp-nav" aria-label="Settle">
          <a href="#pipeline">Pipeline</a>
          <a href="#figures">Sample data</a>
          <a href="#security">Security</a>
          <a href={REPO} target="_blank" rel="noopener noreferrer">Source</a>
          <a className="lp-btn lp-btn-secondary lp-nav-signin" href={signinHref} onClick={openSignin}>Sign in</a>
        </nav>
      </header>

      <section className="lp-section lp-hero" id="overview" aria-labelledby="lp-title">
        <div className="lp-label">
          <span className="lp-num num">01</span>
          <p className="lp-label-text">Overview</p>
        </div>
        <div className="lp-content">
          <div className="lp-hero-dial is-paused" ref={dialRef} aria-hidden="true">
            <BrandMark size={280} variant="hero" />
          </div>
          <div className="lp-hero-copy">
            <h1 className="lp-h1" id="lp-title">Transaction intelligence you run yourself.</h1>
            <p className="lp-lede">
              Settle logs spending to a double-entry ledger, shows patterns from it, and marks each
              pipeline stage as working today or planned.
            </p>
            <div className="lp-actions">
              <button
                type="button"
                className="lp-btn lp-btn-primary"
                onClick={() => void tryDemo()}
                disabled={exploreDisabled}
              >
                {exploreLabel}
              </button>
              <a className="lp-btn lp-btn-secondary" href={signinHref} onClick={openSignin}>Sign in</a>
              <a className="lp-link" href={REPO} target="_blank" rel="noopener noreferrer">View the source</a>
            </div>
            {demoError ? <p className="lp-error" role="alert">{demoError}</p> : null}
            {bootError ? <p className="lp-error" role="alert">{bootError}</p> : null}
          </div>
        </div>
      </section>

      <section className="lp-section" id="pipeline" aria-labelledby="lp-pipeline-title">
        <div className="lp-label">
          <span className="lp-num num">02</span>
          <h2 className="lp-label-text" id="lp-pipeline-title">Pipeline</h2>
        </div>
        <div className="lp-content">
          <svg
            className="lp-flow"
            viewBox="0 0 1000 140"
            width="100%"
            role="img"
            aria-labelledby="lp-flow-title lp-flow-desc"
          >
            <title id="lp-flow-title">The Settle pipeline</title>
            <desc id="lp-flow-desc">
              Five stages joined left to right by thin arrows: 1 Import, 2 Reconcile, 3 Resolve,
              4 Detect, 5 Forecast.
            </desc>
            {STAGES.map((stage, index) => (
              <g key={stage.name}>
                <rect className="lp-flow-box" x={boxX(index)} y={30} width={BOX_W} height={80} rx={2} />
                <text className="lp-flow-step" x={boxX(index) + 14} y={54}>{stage.n}</text>
                <text className="lp-flow-name" x={boxX(index) + 14} y={86}>{stage.name}</text>
                {index < STAGES.length - 1 ? (
                  <g>
                    <line
                      className="lp-flow-link"
                      x1={boxX(index) + BOX_W}
                      y1={70}
                      x2={boxX(index) + BOX_W + BOX_GAP}
                      y2={70}
                    />
                    <path
                      className="lp-flow-link"
                      d={`M ${boxX(index) + BOX_W + 24} 66 L ${boxX(index) + BOX_W + BOX_GAP} 70 L ${boxX(index) + BOX_W + 24} 74`}
                    />
                  </g>
                ) : null}
              </g>
            ))}
          </svg>

          <ol className="lp-stages">
            {STAGES.map((stage) => (
              <li className="lp-stage" key={stage.name}>
                <p className="lp-stage-head">
                  <span className="lp-stage-name">
                    <span className="lp-num">{stage.n}</span> {stage.name}
                  </span>
                  <span className={`lp-tag${stage.planned ? ' is-planned' : ''}`}>{stage.status}</span>
                </p>
                <p className="lp-stage-body">{stage.body}</p>
              </li>
            ))}
          </ol>

          <p className="lp-note">
            The foundation is an append-only, double-entry ledger, which is live today.
          </p>
        </div>
      </section>

      <section className="lp-section" id="figures" aria-labelledby="lp-figures-title">
        <div className="lp-label">
          <span className="lp-num num">03</span>
          <h2 className="lp-label-text" id="lp-figures-title">Sample data</h2>
        </div>
        <div className="lp-content">
          <p className="lp-kicker">Sample data · a synthetic household, regenerated on every visit</p>
          <div className="lp-figs" ref={figsRef} aria-busy={figures ? undefined : 'true'}>
            {cells.map((cell) => (
              <div className="lp-fig" key={cell.label}>
                <p className="lp-fig-label">{cell.label}</p>
                <p
                  className="lp-fig-value num"
                  data-count-to={cell.count?.to}
                  data-count-kind={cell.count?.kind}
                  data-count-final={cell.count ? cell.value : undefined}
                >
                  {cell.value}
                </p>
              </div>
            ))}
            <div className="lp-fig">
              <p className="lp-fig-label">Largest category</p>
              <p className="lp-fig-value lp-fig-category">
                <span className="lp-fig-name">
                  {figures?.topCategory ? categoryLabel(figures.topCategory) : DASH}
                </span>
                {figures?.topCategorySharePct != null ? (
                  <span className="lp-fig-share num">{figures.topCategorySharePct}%</span>
                ) : null}
              </p>
            </div>
            <div className="lp-fig lp-fig-wide">
              <p className="lp-fig-label">Daily spend</p>
              <svg
                className="lp-chart"
                viewBox={`0 0 300 ${CHART_H}`}
                width="100%"
                preserveAspectRatio="none"
                role="img"
                aria-label={chartLabel}
              >
                {chartDays.map((day, index) => {
                  if (day.spendMinor === 0) return null;
                  const height = Math.max(1, Math.round((day.spendMinor / chartMax) * DAY_PLOT_H));
                  return (
                    <rect
                      key={day.date}
                      className="lp-bar"
                      x={index * DAY_SLOT + (DAY_SLOT - DAY_BAR) / 2}
                      y={DAY_PLOT_H - height}
                      width={DAY_BAR}
                      height={height}
                    />
                  );
                })}
                <line
                  className="lp-baseline"
                  x1="0"
                  y1={DAY_PLOT_H}
                  x2="300"
                  y2={DAY_PLOT_H}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <p className="lp-axis" aria-hidden="true">
                <span>30 days ago</span>
                <span>Today</span>
              </p>
              <p className="lp-sr">
                {days
                  ? `Thirty days of sample spending total ${money(totalSpend)}.`
                  : 'Daily spending for the sample household loads with the figure strip.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="security" aria-labelledby="lp-security-title">
        <div className="lp-label">
          <span className="lp-num num">04</span>
          <h2 className="lp-label-text" id="lp-security-title">Security</h2>
        </div>
        <div className="lp-content">
          <ol className="lp-lines">
            <li className="lp-line">
              <span className="lp-line-num">a</span>
              <p className="lp-line-body">Passwords are stored only as salted scrypt hashes.</p>
            </li>
            <li className="lp-line">
              <span className="lp-line-num">b</span>
              <p className="lp-line-body">The ledger is append-only and double-entry; writes are idempotent.</p>
            </li>
            <li className="lp-line">
              <span className="lp-line-num">c</span>
              <p className="lp-line-body">Settle never asks for your bank password.</p>
            </li>
            <li className="lp-line">
              <span className="lp-line-num">d</span>
              <p className="lp-line-body">
                Two-factor sign-in, row-level security and per-user encryption{' '}
                <span className="lp-tag is-planned">Planned · M2</span>
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="lp-section" id="run" aria-labelledby="lp-run-title">
        <div className="lp-label">
          <span className="lp-num num">05</span>
          <h2 className="lp-label-text" id="lp-run-title">Run it</h2>
        </div>
        <div className="lp-content">
          <p className="lp-body">
            Clone the repository and run <code className="lp-code">npm run dev:stack</code> to
            start the full stack with Docker Compose.
          </p>
          <p className="lp-body">
            One-command self-hosting with your own keys{' '}
            <span className="lp-tag is-planned">Planned · M8</span>
          </p>
          <div className="lp-actions">
            <button
              type="button"
              className="lp-btn lp-btn-primary"
              onClick={() => void tryDemo()}
              disabled={exploreDisabled}
            >
              {exploreLabel}
            </button>
            <a className="lp-link" href={REPO} target="_blank" rel="noopener noreferrer">
              View the source
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
