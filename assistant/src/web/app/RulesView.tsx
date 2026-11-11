import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  api,
  SPEND_CATEGORIES,
  type CategorySource,
  type EnrichedSpendRowView,
  type MerchantMethod,
  type RulePreviewView,
  type RuleView as Rule,
  type RulesResponse,
  type SpendCategory,
} from '../api.js';
import { categoryLabel, categoryMeta } from './categories.js';
import { dayLabel, money, parseMoney } from './format.js';
import { ErrorNotice, Icon, Sheet, Skeleton, EmptyState, useToast } from './ui.js';
import './styles/rules.css';

/**
 * Rules page: a plain form for "when merchant contains X and amount is under Y,
 * set category Z", a preview of the rows it would change, and a list of saved
 * rules. Versions are append-only on the server; this view never edits a past
 * version in place.
 */

const SOURCE_LABEL: Record<CategorySource, string> = {
  user_rule: 'Your rule',
  user_correction: 'You corrected it',
  merchant_default: 'Merchant default',
  keyword: 'Keyword',
  manual: 'Picked by you',
  unresolved: 'Needs a category',
};

const METHOD_LABEL: Record<MerchantMethod, string> = {
  exact_alias: 'Exact alias',
  similarity: 'Similar name',
  unresolved: 'No match',
};

interface RuleDraft {
  merchantContains: string;
  maxAmountMinor: number | null;
  category: SpendCategory;
}

const EMPTY_DRAFT: RuleDraft = { merchantContains: '', maxAmountMinor: null, category: 'other' };

function draftFromRule(rule: Rule): RuleDraft {
  return {
    merchantContains: rule.merchantContains,
    maxAmountMinor: rule.maxAmountMinor,
    category: rule.category,
  };
}

function amountText(minor: number | null): string {
  return minor === null ? '' : (minor / 100).toFixed(2).replace(/\.00$/, '');
}

function ruleSentence(rule: Pick<Rule, 'merchantContains' | 'maxAmountMinor' | 'category'>): string {
  const cap = rule.maxAmountMinor === null ? '' : ` and the amount is under ${money(rule.maxAmountMinor)}`;
  return `When the descriptor contains “${rule.merchantContains}”${cap}, set ${categoryLabel(rule.category)}.`;
}

export function RulesView({ accountId, onChanged }: { accountId: string; onChanged?: () => Promise<void> }) {
  const toast = useToast();
  const [data, setData] = useState<RulesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const [capText, setCapText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ result: RulePreviewView; draft: RuleDraft; applyRuleId: string | null } | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [editDraft, setEditDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const [editCapText, setEditCapText] = useState('');
  const [fixing, setFixing] = useState<EnrichedSpendRowView | null>(null);
  const [fixName, setFixName] = useState('');
  const [fixCategory, setFixCategory] = useState<SpendCategory>('other');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.rules(accountId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { void reload(); }, [reload]);

  const recent = useMemo(() => data?.transactions.slice(0, 10) ?? [], [data]);
  const unresolved = data?.transactions.filter((row) => row.merchantId === null) ?? [];

  function readDraft(): RuleDraft | null {
    const merchantContains = draft.merchantContains.trim();
    if (!merchantContains) {
      setFormError('Enter a merchant or descriptor fragment first.');
      return null;
    }
    const raw = capText.trim();
    const maxAmountMinor = raw ? parseMoney(raw) : null;
    if (raw && (maxAmountMinor === null || maxAmountMinor <= 0)) {
      setFormError('Amount cap must be a positive dollar amount, or leave it empty.');
      return null;
    }
    setFormError(null);
    return { merchantContains, maxAmountMinor, category: draft.category };
  }

  async function openPreview(ruleDraft: RuleDraft, applyRuleId: string | null) {
    setBusy(true);
    setFormError(null);
    try {
      const result = await api.previewRule(accountId, ruleDraft);
      setPreview({ result, draft: ruleDraft, applyRuleId });
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function savePreview(apply: boolean) {
    if (!preview) return;
    setBusy(true);
    try {
      if (preview.applyRuleId) {
        const applied = await api.applyRule(accountId, preview.applyRuleId);
        toast(`Applied to ${applied.applied} past ${applied.applied === 1 ? 'spend' : 'spends'}`, { tone: 'good' });
      } else {
        const rule = await api.createRule(accountId, preview.draft);
        let appliedCount = 0;
        if (apply) {
          const applied = await api.applyRule(accountId, rule.ruleId);
          appliedCount = applied.applied;
        }
        toast(apply
          ? `Rule saved · ${appliedCount} past ${appliedCount === 1 ? 'spend' : 'spends'} updated`
          : 'Rule saved. It applies to new spends.', { tone: 'good' });
      }
      setPreview(null);
      setDraft(EMPTY_DRAFT);
      setCapText('');
      await reload();
      await onChanged?.();
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function archive(rule: Rule) {
    setBusy(true);
    try {
      await api.archiveRule(accountId, rule.ruleId);
      toast('Rule archived. Past corrections stay in place.', { tone: 'good' });
      await reload();
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(rule: Rule) {
    setEditing(rule);
    setEditDraft(draftFromRule(rule));
    setEditCapText(amountText(rule.maxAmountMinor));
  }

  async function saveEdit() {
    if (!editing) return;
    const merchantContains = editDraft.merchantContains.trim();
    if (!merchantContains) {
      toast('Enter a merchant or descriptor fragment.', { tone: 'bad' });
      return;
    }
    const raw = editCapText.trim();
    const maxAmountMinor = raw ? parseMoney(raw) : null;
    if (raw && (maxAmountMinor === null || maxAmountMinor <= 0)) {
      toast('Amount cap must be a positive dollar amount.', { tone: 'bad' });
      return;
    }
    setBusy(true);
    try {
      const updated = await api.updateRule(accountId, editing.ruleId, {
        merchantContains,
        maxAmountMinor,
        category: editDraft.category,
      });
      toast(`Saved version ${updated.version}. Apply it if you want it to rewrite past spends.`, { tone: 'good' });
      setEditing(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  function startFix(tx: EnrichedSpendRowView) {
    setFixing(tx);
    setFixName(tx.merchantName ?? tx.descriptorClean);
    setFixCategory(tx.category);
  }

  async function saveFix() {
    if (!fixing) return;
    const merchantName = fixName.trim();
    if (!merchantName) {
      toast('Give this merchant a name.', { tone: 'bad' });
      return;
    }
    setBusy(true);
    try {
      await api.correctMerchant(accountId, {
        transactionId: fixing.id,
        merchantName,
        category: fixCategory,
      });
      toast('Correction saved. That descriptor will resolve here next time.', { tone: 'good' });
      setFixing(null);
      await reload();
      await onChanged?.();
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="v-view rules-view">
        <header className="v-head"><h1 className="v-title">Rules</h1><p className="v-sub">Loading merchants and categories…</p></header>
        <Skeleton height={84} />
        <Skeleton height={260} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="v-view rules-view">
        <header className="v-head"><h1 className="v-title">Rules</h1></header>
        <ErrorNotice message={error} onRetry={() => void reload()} />
      </div>
    );
  }

  if (!data) return null;
  const resolvedPct = data.stats.transactions === 0 ? 0 : Math.round((data.stats.resolved / data.stats.transactions) * 100);

  return (
    <div className="v-view rules-view">
      <header className="v-head">
        <h1 className="v-title">Rules</h1>
        <p className="v-sub">Clean the statement text, resolve the merchant, then apply one visible category source.</p>
      </header>

      <div className="v-figs">
        <div className="v-fig">
          <p className="v-fig-label">Active rules</p>
          <p className="v-fig-value">{data.stats.rules}</p>
          <p className="v-fig-note">Versioned; editing keeps the old one.</p>
        </div>
        <div className="v-fig">
          <p className="v-fig-label">Merchants matched</p>
          <p className="v-fig-value">{resolvedPct}%</p>
          <p className="v-fig-note">{data.stats.resolved} of {data.stats.transactions} recent spends</p>
        </div>
        <div className="v-fig">
          <p className="v-fig-label">Auto-categorized</p>
          <p className="v-fig-value">{data.stats.autoCategorized}</p>
          <p className="v-fig-note">Rule, merchant default or keyword</p>
        </div>
        <div className="v-fig">
          <p className="v-fig-label">Needs a merchant</p>
          <p className="v-fig-value">{data.stats.unresolved}</p>
          <p className="v-fig-note">Correct one and it becomes an alias.</p>
        </div>
      </div>

      <div className="v-grid">
        <div className="stack">
          <section className="v-panel">
            <div className="v-panel-head">
              <div>
                <h2>Your rules</h2>
                <p className="v-sub">Newest active version wins over merchant defaults and keywords.</p>
              </div>
              <span className="v-chip" style={{ '--tint': 'var(--accent)' } as CSSProperties}>{data.rules.length} active</span>
            </div>
            {data.rules.length === 0 ? (
              <EmptyState icon="sliders" title="No rules yet">
                Add one on the right. Preview shows every past spend it would change before you save.
              </EmptyState>
            ) : (
              <ul className="rules-list">
                {data.rules.map((rule) => (
                  <li key={rule.id} className="rules-row">
                    <span className="rules-glyph" style={{ '--tint': categoryMeta(rule.category).color } as CSSProperties} aria-hidden="true">
                      <Icon name={categoryMeta(rule.category).icon} size={17} />
                    </span>
                    <div className="rules-main">
                      <p className="rules-title">{ruleSentence(rule)}</p>
                      <p className="rules-sub">Version {rule.version} · {categoryLabel(rule.category)} · created {dayLabel(rule.createdAt)}</p>
                    </div>
                    <div className="rules-actions">
                      <button type="button" className="btn btn-sm btn-quiet" onClick={() => startEdit(rule)} disabled={busy}>Edit</button>
                      <button type="button" className="btn btn-sm btn-quiet" onClick={() => void openPreview(draftFromRule(rule), rule.ruleId)} disabled={busy}>Apply</button>
                      <button type="button" className="btn btn-sm btn-quiet rules-archive" onClick={() => void archive(rule)} disabled={busy}>Archive</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="v-panel">
            <div className="v-panel-head">
              <div>
                <h2>Recent spends</h2>
                <p className="v-sub">What the cascade decided, and why.</p>
              </div>
              {unresolved.length > 0 ? <span className="v-chip rules-chip-warn">{unresolved.length} unresolved</span> : null}
            </div>
            {recent.length === 0 ? (
              <p className="v-empty"><span className="v-empty-title">No spends yet.</span> Log one and the descriptor is cleaned on the way in.</p>
            ) : (
              <ul className="rules-tx-list">
                {recent.map((tx) => (
                  <li key={tx.id} className="rules-tx">
                    <span className="rules-glyph" style={{ '--tint': categoryMeta(tx.category).color } as CSSProperties} aria-hidden="true">
                      <Icon name={categoryMeta(tx.category).icon} size={17} />
                    </span>
                    <div className="rules-main">
                      <p className="rules-title">{(tx.merchantName ?? tx.descriptorClean) || 'No descriptor'}</p>
                      <p className="rules-sub">
                        {dayLabel(tx.occurredAt)} · {SOURCE_LABEL[tx.categorySource]}
                        {tx.merchantMethod === 'similarity' ? ` · ${Math.round(tx.merchantConfidence * 100)}% name match` : ''}
                        {tx.matchedKeyword ? ` · keyword ${tx.matchedKeyword}` : ''}
                      </p>
                    </div>
                    <span className="v-chip" style={{ '--tint': categoryMeta(tx.category).color } as CSSProperties}>{categoryLabel(tx.category)}</span>
                    <span className="rules-amount">{money(tx.amountMinor)}</span>
                    <button type="button" className="btn btn-sm btn-quiet rules-fix" onClick={() => startFix(tx)} disabled={busy}>
                      {tx.merchantId === null ? 'Resolve' : 'Fix'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="v-side">
          <section className="v-panel">
            <div className="v-panel-head">
              <div>
                <h2>New rule</h2>
                <p className="v-sub">Preview first; nothing changes until you save.</p>
              </div>
            </div>
            <form className="rules-form" onSubmit={(e) => { e.preventDefault(); const next = readDraft(); if (next) void openPreview(next, null); }}>
              <label className="field" htmlFor="rule-merchant">
                <span>When merchant contains</span>
                <input
                  id="rule-merchant"
                  className="input"
                  value={draft.merchantContains}
                  onChange={(e) => { setDraft((d) => ({ ...d, merchantContains: e.target.value })); setFormError(null); }}
                  placeholder="STARBUCKS, SQ *, corner mart…"
                  maxLength={80}
                  autoComplete="off"
                />
              </label>
              <label className="field" htmlFor="rule-cap">
                <span>And amount is under (optional)</span>
                <input
                  id="rule-cap"
                  className="input"
                  inputMode="decimal"
                  value={capText}
                  onChange={(e) => { setCapText(e.target.value); setFormError(null); }}
                  placeholder="25.00"
                  autoComplete="off"
                />
              </label>
              <label className="field" htmlFor="rule-category">
                <span>Set category</span>
                <select
                  id="rule-category"
                  className="input"
                  value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as SpendCategory }))}
                >
                  {SPEND_CATEGORIES.map((category) => (
                    <option key={category} value={category}>{categoryLabel(category)}</option>
                  ))}
                </select>
              </label>
              {formError ? <p className="error-text" role="alert">{formError}</p> : null}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Checking…' : 'Preview affected spends'}
              </button>
            </form>
          </section>

          <section className="v-panel">
            <div className="v-panel-head"><h2>How a category is picked</h2></div>
            <ol className="rules-cascade">
              <li><span>1</span><div><strong>Your correction</strong><p>A merchant you fixed, or a category you picked.</p></div></li>
              <li><span>2</span><div><strong>Your active rule</strong><p>Newest version first; amount cap is strict.</p></div></li>
              <li><span>3</span><div><strong>Merchant default</strong><p>Set by the catalog or by a correction.</p></div></li>
              <li><span>4</span><div><strong>Keyword fallback</strong><p>Plain words such as PHARMACY or GAS.</p></div></li>
              <li><span>5</span><div><strong>Unresolved</strong><p>Shown as Other until a person fixes it.</p></div></li>
            </ol>
          </section>

          <section className="v-panel">
            <div className="v-panel-head"><h2>Merchant catalog</h2></div>
            <p className="v-sub">{data.merchants.length} known merchants across your account. Aliases are learned from corrections.</p>
            <ul className="rules-merchants">
              {data.merchants.slice(0, 8).map((merchant) => (
                <li key={merchant.id}>
                  <span>{merchant.name}</span>
                  <span className="rules-merchant-meta">{merchant.defaultCategory ? categoryLabel(merchant.defaultCategory) : 'No default'}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <Sheet
        open={preview !== null}
        title={preview?.applyRuleId ? 'Apply rule to past spends' : 'Preview rule'}
        subtitle={preview ? ruleSentence(preview.draft) : undefined}
        size="wide"
        onClose={() => { if (!busy) setPreview(null); }}
      >
        {preview ? (
          <div className="stack">
            <div className="rules-preview-figs">
              <div><span>Matching spends</span><strong>{preview.result.affected}</strong></div>
              <div><span>Categories touched</span><strong>{preview.result.byCategory.length}</strong></div>
              {preview.result.skipped > 0 ? (
                <div><span>Left alone (already corrected)</span><strong>{preview.result.skipped}</strong></div>
              ) : null}
            </div>
            {preview.result.transactions.length === 0 ? (
              <EmptyState icon="search" title="No past spends match">
                The rule can still be saved. It will apply to new spends as they arrive.
              </EmptyState>
            ) : (
              <>
                <ul className="rules-preview-list">
                  {preview.result.transactions.slice(0, 12).map((row) => (
                    <li key={row.transactionId}>
                      <div className="rules-main">
                        <p className="rules-title">{(row.merchantName ?? row.descriptorClean) || 'No descriptor'}</p>
                        <p className="rules-sub">{dayLabel(row.occurredAt)} · {SOURCE_LABEL[row.previousSource]} → {categoryLabel(row.category)}</p>
                      </div>
                      <span className="rules-amount">{money(row.amountMinor)}</span>
                    </li>
                  ))}
                </ul>
                {preview.result.transactions.length > 12 ? (
                  <p className="v-sub">Showing 12 of {preview.result.transactions.length} matches.</p>
                ) : null}
              </>
            )}
            <div className="rules-sheet-actions">
              <button type="button" className="btn" onClick={() => setPreview(null)} disabled={busy}>Cancel</button>
              {preview.applyRuleId ? (
                <button type="button" className="btn btn-primary" onClick={() => void savePreview(true)} disabled={busy}>
                  {busy ? 'Applying…' : `Apply to ${preview.result.affected} past ${preview.result.affected === 1 ? 'spend' : 'spends'}`}
                </button>
              ) : (
                <>
                  <button type="button" className="btn" onClick={() => void savePreview(false)} disabled={busy}>
                    {busy ? 'Saving…' : 'Save for new spends'}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void savePreview(true)} disabled={busy}>
                    {busy ? 'Saving…' : 'Save and apply'}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={editing !== null}
        title="Edit rule"
        subtitle="Saving creates a new version. The old version stays in history."
        onClose={() => { if (!busy) setEditing(null); }}
      >
        {editing ? (
          <FormDraft
            merchantContains={editDraft.merchantContains}
            capText={editCapText}
            category={editDraft.category}
            onMerchant={(value) => setEditDraft((d) => ({ ...d, merchantContains: value }))}
            onCap={setEditCapText}
            onCategory={(value) => setEditDraft((d) => ({ ...d, category: value }))}
            onSubmit={() => void saveEdit()}
            submitLabel={busy ? 'Saving…' : `Save version ${editing.version + 1}`}
            disabled={busy}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={fixing !== null}
        title="Fix the merchant"
        subtitle={fixing ? `Descriptor: ${fixing.descriptorClean || 'none'}` : undefined}
        onClose={() => { if (!busy) setFixing(null); }}
      >
        {fixing ? (
          <form className="rules-form" onSubmit={(e) => { e.preventDefault(); void saveFix(); }}>
            <label className="field" htmlFor="fix-name">
              <span>Merchant name</span>
              <input
                id="fix-name"
                className="input"
                value={fixName}
                onChange={(e) => setFixName(e.target.value)}
                maxLength={80}
                autoComplete="off"
                data-autofocus
              />
            </label>
            <label className="field" htmlFor="fix-category">
              <span>Category for this spend</span>
              <select id="fix-category" className="input" value={fixCategory} onChange={(e) => setFixCategory(e.target.value as SpendCategory)}>
                {SPEND_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{categoryLabel(category)}</option>
                ))}
              </select>
            </label>
            <p className="v-sub">The cleaned descriptor is added as an alias for this merchant, so later imports resolve the same way.</p>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
          </form>
        ) : null}
      </Sheet>
    </div>
  );
}

function FormDraft({
  merchantContains,
  capText,
  category,
  onMerchant,
  onCap,
  onCategory,
  onSubmit,
  submitLabel,
  disabled,
}: {
  merchantContains: string;
  capText: string;
  category: SpendCategory;
  onMerchant: (value: string) => void;
  onCap: (value: string) => void;
  onCategory: (value: SpendCategory) => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled: boolean;
}) {
  return (
    <form className="rules-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <label className="field" htmlFor="edit-merchant">
        <span>When merchant contains</span>
        <input id="edit-merchant" className="input" value={merchantContains} onChange={(e) => onMerchant(e.target.value)} maxLength={80} autoComplete="off" data-autofocus />
      </label>
      <label className="field" htmlFor="edit-cap">
        <span>And amount is under (optional)</span>
        <input id="edit-cap" className="input" inputMode="decimal" value={capText} onChange={(e) => onCap(e.target.value)} placeholder="25.00" autoComplete="off" />
      </label>
      <label className="field" htmlFor="edit-category">
        <span>Set category</span>
        <select id="edit-category" className="input" value={category} onChange={(e) => onCategory(e.target.value as SpendCategory)}>
          {SPEND_CATEGORIES.map((item) => (
            <option key={item} value={item}>{categoryLabel(item)}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={disabled}>{submitLabel}</button>
    </form>
  );
}
