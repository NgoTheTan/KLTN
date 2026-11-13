/**
 * S1: Parse, Segment, Language Detection
 *
 * Responsibilities:
 * - Read raw document (PDF via unpdf, DOCX via mammoth, Markdown, plain text, email)
 * - Reject scanned/image-only PDFs lacking a text layer with an actionable error (FR-ING-008)
 * - Clean content (email: remove quoted replies, signatures, merge threads)
 * - Split into segments by structure, NOT mid-sentence
 * - Assign unique IDs and position locators to each segment
 * - Detect language per segment (vi/en) using local rules
 * - Register all segments in the Coverage Ledger
 *
 * Tier: 0 only (format parser, sentence splitter, local language detection).
 * DOES NOT call LLM.
 */

import * as mammoth from 'mammoth';
import { extractText as extractPdfText } from 'unpdf';
import type { Segment } from '@srs-tool/schemas';
import type { CoverageLedger } from '../ledger/coverage.js';

export class ScannedPdfError extends Error {
  readonly code = 'SCANNED_PDF_UNSUPPORTED';
  constructor(
    message = 'Tệp PDF không có lớp văn bản (PDF ảnh quét/scan). Vui lòng tải bản PDF gốc xuất từ trình soạn thảo hoặc tệp DOCX/TXT.',
  ) {
    super(message);
    this.name = 'ScannedPdfError';
  }
}

export interface ParseSegmentInput {
  documentId: string;
  content: string | Buffer | Uint8Array;
  /** MIME type or file extension to determine parser */
  contentType:
    | 'text/plain'
    | 'text/markdown'
    | 'application/pdf'
    | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    | 'message/rfc822';
}

export interface ParseSegmentOutput {
  segments: Segment[];
}

interface RawBlock {
  text: string;
  /** 1-based line number where the block starts */
  line: number;
  /** Optional 1-based page number for PDF documents */
  page?: number;
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
    // 1. Parse raw content (string or binary Buffer) based on contentType
    const { rawText, pageBreakLines } = await this.extractDocumentText(input.content, input.contentType);

    // 2. Split into structural segments (keeps line + page + heading locators)
    const blocks = this.splitIntoBlocks(rawText, pageBreakLines);

    // 3. Detect language per segment
    const segments: Segment[] = blocks.map((block, i) => ({
      id: crypto.randomUUID(),
      document_id: input.documentId,
      ordinal: i,
      text: block.text,
      locator: {
        ordinal: i,
        line: block.line,
        ...(block.page ? { page: block.page } : {}),
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

  /** Extract plain text from text, email, markdown, DOCX, or PDF buffers. */
  private async extractDocumentText(
    content: string | Buffer | Uint8Array,
    contentType: ParseSegmentInput['contentType'],
  ): Promise<{ rawText: string; pageBreakLines?: number[] }> {
    if (contentType === 'application/pdf') {
      if (typeof content !== 'string') {
        const bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
        if (bytes.byteLength === 0) {
          throw new ScannedPdfError('Tệp PDF rỗng (0 byte). Vui lòng tải tệp PDF hợp lệ.');
        }
        const extracted = await extractPdfText(bytes);
        const pages = Array.isArray(extracted.text) ? extracted.text : [String(extracted.text ?? '')];
        const pageBreakLines: number[] = [];
        let runningLines = 1;
        const normalizedPages = pages.map((p) => {
          const clean = String(p ?? '').replace(/\r\n?/g, '\n').trim();
          pageBreakLines.push(runningLines);
          runningLines += clean.split('\n').length + 1;
          return clean;
        });
        const joined = normalizedPages.join('\n\n');
        if (joined.replace(/\s+/g, '').length < 20) {
          throw new ScannedPdfError();
        }
        return { rawText: this.normalizeText(joined), pageBreakLines };
      }

      const norm = this.normalizeText(content);
      if (norm.replace(/\s+/g, '').length < 20) {
        throw new ScannedPdfError();
      }
      return { rawText: norm };
    }

    if (
      contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
      typeof content !== 'string'
    ) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const res = await mammoth.extractRawText({ buffer: buf });
      return { rawText: this.normalizeText(res.value ?? '') };
    }

    const asString =
      typeof content === 'string'
        ? content
        : Buffer.isBuffer(content)
          ? content.toString('utf-8')
          : Buffer.from(content).toString('utf-8');

    let text = this.normalizeText(asString);
    if (contentType === 'message/rfc822') {
      text = this.cleanEmail(text);
    }
    return { rawText: text };
  }

  private normalizeText(raw: string): string {
    return raw
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      .replace(/[ \t]+\n/g, '\n');
  }

  /**
   * Clean an RFC822-like email: drop headers, quoted replies ("> ..."), reply
   * markers ("On ... wrote:") and signatures ("-- ").
   */
  private cleanEmail(raw: string): string {
    const lines = raw.split('\n');
    let i = 0;
    if (/^[A-Za-z-]+:\s/.test(lines[0] ?? '')) {
      while (i < lines.length && lines[i]!.trim() !== '') i++;
      i++;
    }
    const kept: string[] = [];
    for (; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^--\s*$/.test(line) || /^(Sent from my|Gửi từ)/i.test(line)) break;
      if (/^(On .+ wrote:|Vào .+ đã viết:|-{2,}\s*Original Message\s*-{2,})/i.test(line)) break;
      if (/^\s*>/.test(line)) continue;
      kept.push(line);
    }
    return kept.join('\n');
  }

  /**
   * Split text into structural blocks.
   * Boundaries: headings, blank lines, list items, table rows.
   * NEVER splits mid-sentence.
   */
  private splitIntoBlocks(text: string, pageBreakLines?: number[]): RawBlock[] {
    const lines = text.split('\n');
    const blocks: RawBlock[] = [];
    let heading: string | undefined;
    let current: string[] = [];
    let currentLine = 0;
    let inFence = false;
    let tableHeaderSeen = false;

    const resolvePage = (lineNo: number): number | undefined => {
      if (!pageBreakLines || pageBreakLines.length === 0) return undefined;
      let page = 1;
      for (let p = 0; p < pageBreakLines.length; p++) {
        if (lineNo >= pageBreakLines[p]!) page = p + 1;
      }
      return page;
    };

    const flush = () => {
      const joined = current.join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length > 0) {
        blocks.push({
          text: joined,
          line: currentLine,
          page: resolvePage(currentLine),
          heading,
        });
      }
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
      if (inFence) continue;

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
          tableHeaderSeen = true;
          heading = heading
            ? `${heading} / ${this.tableCells(trimmed).join(' | ')}`
            : this.tableCells(trimmed).join(' | ');
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
   */
  private detectLanguage(text: string): 'vi' | 'en' {
    const viPattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    if (viPattern.test(text)) return 'vi';
    const viStop = /\b(he thong|nguoi dung|phai|duoc|va|cua|cho|khi)\b/i;
    const enStop = /\b(the|shall|must|should|and|of|to|when|system|user)\b/i;
    if (viStop.test(text) && !enStop.test(text)) return 'vi';
    return 'en';
  }
}
