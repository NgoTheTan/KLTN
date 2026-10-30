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

interface RawBlock {
  text: string;
  /** 1-based line number where the block starts */
  line: number;
  /** Nearest preceding heading (section path context) */
  heading?: string;
}

const HEADING_MD = /^#{1,6}\s+(.+)$/;
const HEADING_NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+([A-ZÀ-Ỵ][^.!?]{0,80})$/u;
const LIST_ITEM = /^\s*(?:[-*•+]|\d+(?:\.\d+)*[.)]|[a-z][.)])\s+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
const FENCE = /^\s*```/;

export class S1ParseAndSegment {
  constructor(private readonly ledger: CoverageLedger) {}

  async process(input: ParseSegmentInput): Promise<ParseSegmentOutput> {
    // 1. Parse raw content based on contentType
    const rawText = await this.extractText(input.content, input.contentType);

    // 2. Split into structural segments (keeps line + heading locators)
    const blocks = this.splitIntoBlocks(rawText);

    // 3. Detect language per segment
    const segments: Segment[] = blocks.map((block, i) => ({
      id: crypto.randomUUID(),
      document_id: input.documentId,
      ordinal: i,
      text: block.text,
      locator: {
        ordinal: i,
        line: block.line,
        ...(block.heading ? { heading: block.heading } : {}),
      },
      language: this.detectLanguage(block.text),
      coverage_status: 'unmapped',
      resolved_by: 'rule',
    }));

    // 4. Register in coverage ledger
    this.ledger.registerSegments(segments);

    return { segments };
  }

  /** Extract plain text from various document formats. */
  private async extractText(content: string, contentType: string): Promise<string> {
    // Normalise line endings and strip BOM / zero-width characters
    let text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[\u200B-\u200D\u2060]/g, '');

    if (contentType === 'message/rfc822') {
      text = this.cleanEmail(text);
    }
    // PDF/DOCX binary parsing is handled upstream by the ingestion layer, which hands
    // us extracted text; here we only normalise whitespace.
    return text.replace(/[ \t]+\n/g, '\n');
  }

  /**
   * Clean an RFC822-like email: drop headers, quoted replies ("> ..."), reply
   * markers ("On ... wrote:") and signatures ("-- ").
   */
  private cleanEmail(raw: string): string {
    const lines = raw.split('\n');
    let i = 0;
    // Skip headers until first blank line (only if the first line looks like a header)
    if (/^[A-Za-z-]+:\s/.test(lines[0] ?? '')) {
      while (i < lines.length && lines[i]!.trim() !== '') i++;
      i++;
    }
    const kept: string[] = [];
    for (; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^--\s*$/.test(line) || /^(Sent from my|Gửi từ)/i.test(line)) break; // signature
      if (/^(On .+ wrote:|Vào .+ đã viết:|-{2,}\s*Original Message\s*-{2,})/i.test(line)) break; // quoted thread
      if (/^\s*>/.test(line)) continue; // quoted reply line
      kept.push(line);
    }
    return kept.join('\n');
  }

  /**
   * Split text into structural blocks.
   * Boundaries: headings, blank lines, list items, table rows.
   * NEVER splits mid-sentence; wrapped lines belonging to a paragraph or a list
   * item are re-joined into one block.
   */
  private splitIntoBlocks(text: string): RawBlock[] {
    const lines = text.split('\n');
    const blocks: RawBlock[] = [];
    let heading: string | undefined;
    let current: string[] = [];
    let currentLine = 0;
    let inFence = false;
    let tableHeaderSeen = false;

    const flush = () => {
      const joined = current.join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length > 0) blocks.push({ text: joined, line: currentLine, heading });
      current = [];
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]!;
      const lineNo = idx + 1;
      const trimmed = line.trim();

      if (FENCE.test(line)) {
        inFence = !inFence;
        flush();
        continue;
      }
      if (inFence) continue; // code blocks are not requirements

      if (trimmed === '') {
        flush();
        tableHeaderSeen = false;
        continue;
      }

      const md = HEADING_MD.exec(trimmed);
      const numbered = !md && !LIST_ITEM.test(trimmed) ? HEADING_NUMBERED.exec(trimmed) : null;
      if (md || numbered) {
        flush();
        heading = (md ? md[1] : trimmed)!.trim();
        continue;
      }

      if (TABLE_ROW.test(trimmed)) {
        flush();
        if (TABLE_SEPARATOR.test(trimmed)) continue;
        if (!tableHeaderSeen) {
          // first row is the header: remember context, not a requirement itself
          tableHeaderSeen = true;
          heading = heading ? `${heading} / ${this.tableCells(trimmed).join(' | ')}` : this.tableCells(trimmed).join(' | ');
          continue;
        }
        currentLine = lineNo;
        current = [this.tableCells(trimmed).join('. ')];
        flush();
        continue;
      }

      if (LIST_ITEM.test(trimmed)) {
        flush();
        currentLine = lineNo;
        current = [trimmed.replace(LIST_ITEM, '')];
        continue;
      }

      if (current.length === 0) currentLine = lineNo;
      current.push(trimmed);
    }
    flush();
    return blocks;
  }

  private tableCells(row: string): string[] {
    return row
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }

  /**
   * Detect language using local rules (no LLM, no external API).
   * Vietnamese: presence of diacritics (ạăắ...) and stop words
   * English: absence of diacritics + common English stop words
   */
  private detectLanguage(text: string): 'vi' | 'en' {
    // Vietnamese-only diacritics pattern (excludes plain Latin accents)
    const viPattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    if (viPattern.test(text)) return 'vi';
    // Unaccented Vietnamese is rare in specs but handle common stop words
    const viStop = /\b(he thong|nguoi dung|phai|duoc|va|cua|cho|khi)\b/i;
    const enStop = /\b(the|shall|must|should|and|of|to|when|system|user)\b/i;
    if (viStop.test(text) && !enStop.test(text)) return 'vi';
    return 'en';
  }
}
