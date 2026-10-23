import type { Segment } from '@srs-tool/schemas';

/**
 * Coverage Ledger
 *
 * Tracks which source segments have been covered by extracted requirements.
 * The ledger ensures no segment is silently dropped - every segment must
 * eventually reach a terminal state: mapped, not_requirement, or unresolved.
 *
 * This is the key mechanism for "không mất yêu cầu" (no requirement loss).
 */
export class CoverageLedger {
  private segments = new Map<string, Segment>();

  /**
   * S1: Register all segments from a document.
   * All start as 'unmapped'.
   */
  registerSegments(segments: Segment[]): void {
    for (const seg of segments) {
      this.segments.set(seg.id, { ...seg, coverage_status: 'unmapped' });
    }
  }

  /**
   * Mark a segment as covered by a requirement.
   */
  markMapped(segmentId: string): void {
    const seg = this.getOrThrow(segmentId);
    this.segments.set(segmentId, { ...seg, coverage_status: 'mapped' });
  }

  /**
   * Mark a segment as explicitly not a requirement (with reason logged separately).
   */
  markNotRequirement(segmentId: string): void {
    const seg = this.getOrThrow(segmentId);
    this.segments.set(segmentId, { ...seg, coverage_status: 'not_requirement' });
  }

  /**
   * Mark a segment as unresolved (S8 could not cover it).
   */
  markUnresolved(segmentId: string): void {
    const seg = this.getOrThrow(segmentId);
    this.segments.set(segmentId, { ...seg, coverage_status: 'unresolved' });
  }

  /** Get all unmapped segments (not yet processed). */
  getUnmapped(): Segment[] {
    return [...this.segments.values()].filter(s => s.coverage_status === 'unmapped');
  }

  /** Get all unresolved segments (pipeline could not handle). */
  getUnresolved(): Segment[] {
    return [...this.segments.values()].filter(s => s.coverage_status === 'unresolved');
  }

  /** Generate coverage report. */
  getReport() {
    const all = [...this.segments.values()];
    const total = all.length;
    const mapped = all.filter(s => s.coverage_status === 'mapped').length;
    const notReq = all.filter(s => s.coverage_status === 'not_requirement').length;
    const unresolved = all.filter(s => s.coverage_status === 'unresolved').length;
    const unmapped = all.filter(s => s.coverage_status === 'unmapped').length;
    return {
      total_segments: total,
      mapped,
      not_requirement: notReq,
      unresolved,
      unmapped,
      coverage_pct: total > 0 ? Math.round(((mapped + notReq) / total) * 100) : 0,
    };
  }

  /** Check if all segments are in terminal state (pipeline can stop). */
  isComplete(): boolean {
    return this.getUnmapped().length === 0;
  }

  private getOrThrow(segmentId: string): Segment {
    const seg = this.segments.get(segmentId);
    if (!seg) throw new Error(`Segment not found in ledger: ${segmentId}`);
    return seg;
  }
}
