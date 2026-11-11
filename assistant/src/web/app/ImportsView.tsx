import { useEffect, useMemo, useState } from 'react';
import './styles/views.css';
import './styles/imports.css';
import { api, type ImportColumnMapping, type ImportPreset, type ImportPreview, type ImportRecord } from '../api.js';
import type { WalletData } from './data.js';
import {
  IMPORT_ACCEPT,
  IMPORT_MAX_BYTES,
  importFileError,
  importStageSteps,
  importStatusLabel,
  mappingFromForm,
  mappingToForm,
  type ImportMappingForm,
} from './imports-ui.js';
import { Icon, Skeleton } from './ui.js';

const BLANK_FORM: ImportMappingForm = {
  date: '',
  description: '',
  amount: '',
  debit: '',
  credit: '',
  balance: '',
  category: '',
  dateFormat: 'auto',
  amountSign: 'as-is',
  currency: 'USD',
};

const FILE_REASON: Record<string, string> = {
  unsupported_type: 'Use a CSV, OFX or QFX file. PDF statements are not supported.',
  file_too_large: `That file is over ${Math.round(IMPORT_MAX_BYTES / 1_000_000)} MB. Split it and try again.`,
  empty_file: 'That file is empty.',
};

function extensionOf(name: string): 'csv' | 'ofx' | 'qfx' {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ext === 'ofx' || ext === 'qfx' ? ext : 'csv';
}

function minor(value: number | null | undefined, currency = 'USD'): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
}

function columnOptions(columns: string[], value: string) {
  return (
    <>
      <option value="">None</option>
      {columns.map((column) => <option key={column} value={column}>{column}</option>)}
      {value && !columns.includes(value) ? <option value={value}>{value}</option> : null}
    </>
  );
}

export function ImportsView({ me, data, onChanged }: {
  me: { id: string };
  data: WalletData | null;
  onChanged: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<{ name: string; size: number; content: string; source: 'csv' | 'ofx' | 'qfx' } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [form, setForm] = useState<ImportMappingForm>(BLANK_FORM);
  const [presets, setPresets] = useState<ImportPreset[]>([]);
  const [presetId, setPresetId] = useState<string>('');
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [busy, setBusy] = useState<'reading' | 'importing' | 'history' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');

  const loadHistory = async () => {
    setBusy((current) => current ?? 'history');
    try {
      const [list, saved] = await Promise.all([api.imports(me.id), api.importPresets(me.id)]);
      setHistory(list.imports);
      setPresets(saved.presets);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load import history.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id]);

  const steps = useMemo(() => (record ? importStageSteps(record) : []), [record]);
  const rejections = steps.find((step) => step.id === 'validate')?.rejections ?? [];
  const recent = data?.view.importedTransactions ?? [];

  const chooseFile = async (picked: File | null) => {
    if (!picked) return;
    setError(null);
    setRecord(null);
    setPreview(null);
    setPresetId('');
    const reason = importFileError(picked);
    if (reason) {
      setFile(null);
      setError(FILE_REASON[reason] ?? 'That file cannot be imported.');
      return;
    }
    const source = extensionOf(picked.name);
    setBusy('reading');
    try {
      const content = await picked.text();
      setFile({ name: picked.name, size: picked.size, content, source });
      if (source !== 'csv') {
        setForm(BLANK_FORM);
        return;
      }
      const result = await api.importPreview(me.id, { filename: picked.name, content });
      setPreview(result);
      setForm(result.suggestedMapping ? mappingToForm(result.suggestedMapping) : BLANK_FORM);
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(null);
    }
  };

  const usePreset = (id: string) => {
    setPresetId(id);
    const preset = presets.find((entry) => entry.id === id);
    if (preset) setForm(mappingToForm(preset.mapping));
  };

  const runImport = async () => {
    if (!file) return;
    if (file.source === 'csv' && (!form.date || !form.description || (!form.amount && !form.debit && !form.credit))) {
      setError('Map a date, a description, and either an amount or debit/credit columns.');
      return;
    }
    setBusy('importing');
    setError(null);
    setRecord(null);
    try {
      const mapping = file.source === 'csv' ? mappingFromForm(form) : undefined;
      const result = await api.importUpload(me.id, {
        filename: file.name,
        content: file.content,
        mapping,
        presetId: presetId || null,
        accountKind: form.amountSign === 'invert' ? 'credit' : 'checking',
      });
      setRecord(result.import);
      await loadHistory();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed. Nothing was posted.');
    } finally {
      setBusy(null);
    }
  };

  const savePreset = async () => {
    if (!presetName.trim()) return;
    setError(null);
    try {
      const mapping: ImportColumnMapping = mappingFromForm(form);
      const saved = await api.saveImportPreset(me.id, { name: presetName.trim(), source: 'csv', mapping });
      setPresets((current) => [...current, saved.preset]);
      setPresetName('');
      setPresetId(saved.preset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that preset.');
    }
  };

  const openHistory = async (row: ImportRecord) => {
    setError(null);
    setBusy('history');
    try {
      const detail = await api.importDetail(me.id, row.id);
      setRecord(detail.import);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that import.');
    } finally {
      setBusy(null);
    }
  };

  const setField = (key: keyof ImportMappingForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="v-view imports-view">
      <header className="v-head">
        <h1 className="v-title">Imports</h1>
        <p className="v-sub">Upload a statement, map its columns, and review every row before it reaches Transactions.</p>
      </header>

      <section className="v-panel glass imp-card" aria-labelledby="upload-title">
        <div className="v-panel-head">
          <div>
            <p className="imp-kicker">Step 1</p>
            <h2 id="upload-title">Choose a file</h2>
          </div>
          <span className="imp-limit">CSV · OFX · QFX · up to 2 MB</span>
        </div>
        <label className={`imp-drop${file ? ' has-file' : ''}`}>
          <input
            type="file"
            accept={IMPORT_ACCEPT}
            onChange={(event) => { void chooseFile(event.target.files?.[0] ?? null); event.target.value = ''; }}
          />
          <span className="imp-drop-icon"><Icon name={file ? 'file' : 'upload'} size={22} /></span>
          <span className="imp-drop-copy">
            <strong>{file ? file.name : 'Drop a statement here or browse'}</strong>
            <span>{file ? `${(file.size / 1024).toFixed(1)} KB · ${file.source.toUpperCase()}` : 'The file stays in this request. No cloud queue.'}</span>
          </span>
          <span className="btn btn-sm">{file ? 'Replace' : 'Browse'}</span>
        </label>
        {busy === 'reading' ? <p className="hint" aria-live="polite">Reading columns…</p> : null}
        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </section>

      {file?.source === 'csv' && preview ? (
        <section className="v-panel glass imp-card" aria-labelledby="mapping-title">
          <div className="v-panel-head">
            <div>
              <p className="imp-kicker">Step 2</p>
              <h2 id="mapping-title">Map the columns</h2>
            </div>
            <select
              className="imp-preset"
              aria-label="Saved column mapping"
              value={presetId}
              onChange={(event) => usePreset(event.target.value)}
            >
              <option value="">Saved mappings</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
          </div>

          <div className="imp-map-grid">
            <label className="field"><span>Date column</span>
              <select value={form.date} onChange={(event) => setField('date', event.target.value)}>
                <option value="">Choose a column</option>
                {columnOptions(preview.columns, form.date)}
              </select>
            </label>
            <label className="field"><span>Description column</span>
              <select value={form.description} onChange={(event) => setField('description', event.target.value)}>
                <option value="">Choose a column</option>
                {columnOptions(preview.columns, form.description)}
              </select>
            </label>
            <label className="field"><span>Amount column</span>
              <select value={form.amount} onChange={(event) => setField('amount', event.target.value)}>
                {columnOptions(preview.columns, form.amount)}
              </select>
            </label>
            <label className="field"><span>Debit column</span>
              <select value={form.debit} onChange={(event) => setField('debit', event.target.value)}>
                {columnOptions(preview.columns, form.debit)}
              </select>
            </label>
            <label className="field"><span>Credit column</span>
              <select value={form.credit} onChange={(event) => setField('credit', event.target.value)}>
                {columnOptions(preview.columns, form.credit)}
              </select>
            </label>
            <label className="field"><span>Balance column</span>
              <select value={form.balance} onChange={(event) => setField('balance', event.target.value)}>
                {columnOptions(preview.columns, form.balance)}
              </select>
            </label>
            <label className="field"><span>Category column</span>
              <select value={form.category} onChange={(event) => setField('category', event.target.value)}>
                {columnOptions(preview.columns, form.category)}
              </select>
            </label>
            <label className="field"><span>Date format</span>
              <select value={form.dateFormat} onChange={(event) => setField('dateFormat', event.target.value)}>
                <option value="auto">Detect automatically</option>
                <option value="YMD">Year first</option>
                <option value="MDY">Month first</option>
                <option value="DMY">Day first</option>
              </select>
            </label>
            <label className="field"><span>Amount sign</span>
              <select value={form.amountSign} onChange={(event) => setField('amountSign', event.target.value)}>
                <option value="as-is">Keep as shown</option>
                <option value="invert">Invert (credit-card purchases)</option>
              </select>
            </label>
            <label className="field"><span>Currency</span>
              <input value={form.currency} maxLength={3} onChange={(event) => setField('currency', event.target.value.toUpperCase())} />
            </label>
          </div>

          {preview.sampleRows.length > 0 ? (
            <div className="imp-sample">
              <p className="imp-kicker">First rows</p>
              <div className="imp-sample-scroll">
                <table>
                  <thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>
                    {preview.sampleRows.slice(0, 4).map((row, index) => (
                      <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell || '—'}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="imp-preset-save">
            <label className="field"><span>Save this mapping</span>
              <input placeholder="e.g. Chase checking" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
            </label>
            <button type="button" className="btn btn-sm" disabled={!presetName.trim()} onClick={() => { void savePreset(); }}>Save mapping</button>
          </div>
        </section>
      ) : null}

      {file ? (
        <section className="v-panel glass imp-card imp-run" aria-labelledby="run-title">
          <div>
            <p className="imp-kicker">Step 3</p>
            <h2 id="run-title">{file.source === 'csv' ? 'Check and import' : 'Import this statement'}</h2>
            <p className="hint">
              {file.source === 'csv'
                ? 'Rows are validated, deduplicated and posted in this request. Bad rows stay visible with a reason.'
                : 'OFX and QFX carry their own dates, amounts and balances, so no column mapping is needed.'}
            </p>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy === 'importing'} onClick={() => { void runImport(); }}>
            {busy === 'importing' ? 'Importing…' : 'Start import'}
          </button>
          {busy === 'importing' ? (
            <ol className="imp-progress" aria-live="polite">
              {['parse', 'validate', 'stage', 'dedupe', 'post'].map((stage, index) => (
                <li key={stage} className={index === 0 ? 'is-running' : ''}>
                  <span className="imp-dot" /> {stage}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {record ? (
        <section className="v-panel glass imp-card" aria-labelledby="result-title">
          <div className="v-panel-head">
            <div>
              <p className="imp-kicker">Import report</p>
              <h2 id="result-title">{record.filename}</h2>
            </div>
            <span className={`imp-badge ${record.status === 'posted' ? 'is-ok' : 'is-bad'}`}>
              {importStatusLabel(record)}
            </span>
          </div>

          <div className="imp-counts">
            <div><span>Rows read</span><strong className="num">{record.counts.parsed}</strong></div>
            <div><span>Rejected</span><strong className="num">{record.counts.rejected}</strong></div>
            <div><span>Duplicates skipped</span><strong className="num">{record.counts.duplicates}</strong></div>
            <div><span>Posted</span><strong className="num">{record.counts.posted}</strong></div>
          </div>

          <ol className="imp-stages">
            {steps.map((step) => (
              <li key={step.id} className={`is-${step.status}`}>
                <span className="imp-stage-icon"><Icon name={step.status === 'passed' ? 'check' : step.status === 'failed' ? 'alert' : 'info'} size={15} /></span>
                <span><strong>{step.label}</strong><em>{step.detail}</em></span>
              </li>
            ))}
          </ol>

          {rejections.length > 0 ? (
            <div className="imp-rejections">
              <p className="imp-kicker">Rejected rows</p>
              <ul>
                {rejections.map((row) => (
                  <li key={`${row.lineNumber}-${row.reason}`}>
                    <span className="num">Line {row.lineNumber}</span>
                    <span className="imp-reason">{row.reason.replaceAll('_', ' ')}</span>
                    <span>{row.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="imp-recon">
            <span className={`imp-badge ${record.reconciliation.reconciled ? 'is-ok' : 'is-bad'}`}>
              {record.reconciliation.reconciled ? 'Reconciled' : 'Not reconciled'}
            </span>
            <span>Statement close {minor(record.reconciliation.statementClosedMinor, record.statement.currency)}</span>
            <span>Computed {minor(record.reconciliation.computedClosedMinor, record.statement.currency)}</span>
            <span>Difference {minor(record.reconciliation.differenceMinor, record.statement.currency)}</span>
          </div>
          <p className="hint">{record.reconciliation.detail}</p>

          <details className="imp-gates">
            <summary>Quality gates</summary>
            <ul>
              {record.quality.map((gate) => (
                <li key={gate.id}><span className={`imp-dot ${gate.status === 'failed' ? 'is-bad' : 'is-ok'}`} /> <strong>{gate.label}</strong> · {gate.detail}</li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      <section className="v-panel glass imp-card" aria-labelledby="history-title">
        <div className="v-panel-head">
          <div>
            <p className="imp-kicker">Ledger of imports</p>
            <h2 id="history-title">Previous imports</h2>
          </div>
          <button type="button" className="link-btn" onClick={() => { void loadHistory(); }}>Refresh</button>
        </div>
        {busy === 'history' && history.length === 0 ? <Skeleton height={120} /> : history.length === 0 ? (
          <p className="hint">No statements imported yet.</p>
        ) : (
          <ul className="imp-history">
            {history.map((row) => (
              <li key={row.id}>
                <button type="button" className="imp-history-row" onClick={() => { void openHistory(row); }}>
                  <span className="imp-history-main">
                    <strong>{row.filename}</strong>
                    <span>{row.source.toUpperCase()} · {new Date(row.createdAt).toLocaleDateString()} · {row.counts.posted} posted</span>
                  </span>
                  <span className={`imp-badge ${row.reconciliation.reconciled ? 'is-ok' : 'is-bad'}`}>
                    {row.reconciliation.reconciled ? 'Reconciled' : importStatusLabel(row)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 ? (
        <section className="v-panel glass imp-card" aria-labelledby="recent-import-title">
          <div className="v-panel-head">
            <h2 id="recent-import-title">Recent imported transactions</h2>
            <span className="imp-limit">Also in Transactions</span>
          </div>
          <ul className="imp-transactions">
            {recent.slice(0, 8).map((row) => (
              <li key={row.id}>
                <span><strong>{row.descriptorClean || row.descriptor}</strong><span>{row.postedDate} · {row.filename ?? row.source.toUpperCase()}</span></span>
                <span className={`num${row.amountMinor < 0 ? ' is-neg' : ' is-pos'}`}>{row.amount}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
