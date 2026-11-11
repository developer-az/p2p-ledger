/**
 * Pure helpers for the Imports page. Keeping upload limits, mapping form state
 * and stage progress here means the browser UI and tests share one definition.
 */
import type { ImportColumnMapping } from '../../server/importers.js';
import type { ImportRecord, ImportStageState } from '../../server/imports-store.js';
import type { ImportStageId } from '../../server/imports-schema.js';

export const IMPORT_MAX_BYTES = 2_000_000;
export const IMPORT_ACCEPT = '.csv,.ofx,.qfx';

export type ImportFileReason = 'unsupported_type' | 'file_too_large' | 'empty_file';

export function importFileError(file: { name: string; size: number }): ImportFileReason | null {
  if (!/\.(csv|ofx|qfx)$/i.test(file.name)) return 'unsupported_type';
  if (file.size <= 0) return 'empty_file';
  if (file.size > IMPORT_MAX_BYTES) return 'file_too_large';
  return null;
}

export interface ImportMappingForm {
  date: string;
  description: string;
  amount: string;
  debit: string;
  credit: string;
  balance: string;
  category: string;
  dateFormat: 'auto' | 'YMD' | 'MDY' | 'DMY';
  amountSign: 'as-is' | 'invert';
  currency: string;
}

export function mappingToForm(mapping: ImportColumnMapping): ImportMappingForm {
  return {
    date: mapping.date,
    description: mapping.description,
    amount: mapping.amount ?? '',
    debit: mapping.debit ?? '',
    credit: mapping.credit ?? '',
    balance: mapping.balance ?? '',
    category: mapping.category ?? '',
    dateFormat: mapping.dateFormat ?? 'auto',
    amountSign: mapping.amountSign ?? 'as-is',
    currency: mapping.currency ?? 'USD',
  };
}

export function mappingFromForm(form: ImportMappingForm): ImportColumnMapping {
  return {
    date: form.date,
    description: form.description,
    amount: form.amount.trim() || null,
    debit: form.debit.trim() || null,
    credit: form.credit.trim() || null,
    balance: form.balance.trim() || null,
    category: form.category.trim() || null,
    dateFormat: form.dateFormat,
    amountSign: form.amountSign,
    currency: form.currency.toUpperCase() || 'USD',
  };
}

export interface ImportStageStep extends ImportStageState {
  id: ImportStageId;
  rejections?: Array<{ lineNumber: number; reason: string; message: string }>;
}

export function importStageSteps(record: ImportRecord): ImportStageStep[] {
  return (Object.keys(record.stages) as ImportStageId[])
    .map((id) => ({
      ...record.stages[id],
      id,
      ...(id === 'validate'
        ? {
            rejections: record.errors.map((error) => ({
              lineNumber: error.lineNumber,
              reason: error.reason,
              message: error.detail,
            })),
          }
        : {}),
    }))
    .sort((a, b) => ['parse', 'validate', 'stage', 'dedupe', 'post'].indexOf(a.id)
      - ['parse', 'validate', 'stage', 'dedupe', 'post'].indexOf(b.id));
}

export function importSummary(record: ImportRecord): ImportRecord['counts'] & { reconciled: boolean } {
  return { ...record.counts, reconciled: record.reconciliation.reconciled };
}

export function importStatusLabel(record: ImportRecord): string {
  if (record.status === 'posted') {
    return record.counts.posted === 0 ? 'Already imported' : 'Imported';
  }
  if (record.status === 'failed') return 'Needs attention';
  if (record.status === 'rejected') return 'Rejected';
  return 'Importing';
}
