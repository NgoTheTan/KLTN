/**
 * S1: Parse, Segment, Language Detection
 *
 * Responsibilities:
 * - Read raw document (PDF, DOCX, Markdown, plain text, email)
 * - Clean content (email: remove quoted replies, signatures, merge threads)
 * - Split into segments by structure, NOT mid-sentence
 * - Assign unique IDs and position locators to each segment
 * - Detect language per segment (vi/en) using local rules
 * - Register all segments in the Coverage Ledger
 *
 * Tier: 0 only (format parser, sentence splitter, local language detection).
 * DOES NOT call LLM.
 */

import type { Segment } from '@srs-tool/schemas';
import type { CoverageLedger } from '../ledger/coverage.js';

export interface ParseSegmentInput {
  documentId: string;
  content: string;
  /** MIME type or file extension to determine parser */
  contentType: 'text/plain' | 'text/markdown' | 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'message/rfc822';
}

export interface ParseSegmentOutput {
  segments: Segment[];
}

export class S1ParseAndSegment {
  constructor(private readonly ledger: CoverageLedger) {}

  async process(input: ParseSegmentInput): Promise<ParseSegmentOutput> {
    // 1. Parse raw content based on contentType
    const rawText = await this.extractText(input.content, input.contentType);

    // 2. Split into structural segments
    const rawSegments = this.splitIntoSegments(rawText);

    // 3. Detect language per segment
    const segments: Segment[] = rawSegments.map((text, i) => ({
      id: crypto.randomUUID(),
      document_id: input.documentId,
      ordinal: i,
      text: text.trim(),
      locator: { ordinal: i },
      language: this.detectLanguage(text),
      coverage_status: 'unmapped',
      resolved_by: 'rule',
    }));

    // 4. Register in coverage ledger
    this.ledger.registerSegments(segments);

    return { segments };
  }

  /** Extract plain text from various document formats. */
  private async extractText(content: string, contentType: string): Promise<string> {
    // TODO: Implement parsers:
    // - text/plain, text/markdown: return as-is
    // - application/pdf: use pdfjs/unpdf
    // - .docx: use mammoth
    // - message/rfc822: parse email, remove quoted replies & signatures
    return content;
  }

  /**
   * Split text into structural segments.
   * Tries to split on: headings, blank lines, numbered list items.
   * NEVER splits mid-sentence.
   */
  private splitIntoSegments(text: string): string[] {
    // TODO: Implement structural segmentation using:
    // - Heading patterns: /^#{1,6}\s+/, /^\d+\.\s+[A-Z]/
    // - Paragraph breaks: double newline
    // - Numbered list: /^\d+\.\d*\s+/
    // Fallback: split on double newlines
    return text
      .split(/\n\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Detect language using local rules (no LLM, no external API).
   * Vietnamese: presence of diacritics (ạăắ...) and stop words
   * English: absence of diacritics + common English stop words
   */
  private detectLanguage(text: string): 'vi' | 'en' {
    // Vietnamese diacritics pattern
    const viPattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    if (viPattern.test(text)) return 'vi';
    return 'en';
  }
}
