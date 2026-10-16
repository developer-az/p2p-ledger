import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type TraceFn = (line: string) => void;

const TraceContext = createContext<TraceFn>(() => {});

export function useTrace(): TraceFn {
  return useContext(TraceContext);
}

export function ActivityShell({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<string[]>([]);
  const trace = useCallback((line: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setLines((prev) => [...prev.slice(-100), `${ts}  ${line}`]);
  }, []);

  return (
    <TraceContext.Provider value={trace}>
      <section className="activity-console pane" aria-label="Backend trace">
        <div className="pane-hd">
          <strong>trace</strong> · BFF → ledger-service (live PostgreSQL)
        </div>
        <div className="activity-console-body pane-bd" role="log" aria-live="polite">
          {lines.length === 0 ? (
            <p className="dim">Payments, retry storm, and support questions log here — same paths production uses.</p>
          ) : (
            lines.map((line, i) => (
              <div key={`${i}-${line}`} className="trace-line">{line}</div>
            ))
          )}
        </div>
      </section>
      {children}
    </TraceContext.Provider>
  );
}
