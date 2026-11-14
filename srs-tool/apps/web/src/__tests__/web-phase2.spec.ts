import { describe, expect, it } from 'vitest';
import { ApiError, formatApiError } from '../api/client';
import { en } from '../i18n/locales/en';
import { vi } from '../i18n/locales/vi';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, full));
    } else {
      keys.push(full);
      expect(typeof v).toBe('string');
      expect((v as string).trim().length).toBeGreaterThan(0);
    }
  }
  return keys;
}

describe('@srs-tool/web Phase 2', () => {
  it('maintains 100% key parity between vi and en dictionaries (NFR-USA-001)', () => {
    const viKeys = flattenKeys(vi as unknown as Record<string, unknown>).sort();
    const enKeys = flattenKeys(en as unknown as Record<string, unknown>).sort();
    expect(enKeys).toEqual(viKeys);
    expect(viKeys.length).toBeGreaterThan(100);
  });

  it('produces actionable bilingual error hints for 422 scanned PDF, 403 quota, and 409 baseline lock (NFR-USA-005)', () => {
    const pdfVi = formatApiError(new ApiError('Scanned PDF detected', 422), 'vi');
    expect(pdfVi.hint).toContain('PDF');

    const pdfEn = formatApiError(new ApiError('Scanned PDF detected', 422), 'en');
    expect(pdfEn.hint).toContain('text-selectable PDF');

    const quotaVi = formatApiError(new ApiError('Token quota exceeded', 403), 'vi');
    expect(quotaVi.hint).toContain('Eco');

    const quotaEn = formatApiError(new ApiError('Token quota exceeded', 403), 'en');
    expect(quotaEn.hint).toContain('Eco');

    const conflictEn = formatApiError(new ApiError('Baseline blocked', 409), 'en');
    expect(conflictEn.hint).toContain('Inferred');
  });
});
