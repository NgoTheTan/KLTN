import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  Inject,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { StoragePort } from '../../ports';
import { documents } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { S1ParseAndSegment, ScannedPdfError, CoverageLedger } from '@srs-tool/pipeline';
import * as crypto from 'crypto';

export interface IngestTextInput {
  text: string;
  kind?: 'srs' | 'text' | 'email';
  filename?: string;
}

export interface IngestFileInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  kind?: 'srs' | 'text' | 'email';
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB max file size (FR-ING-001)
  private readonly MAX_DOCS_PER_PROJECT = 10; // Max 10 documents per project

  constructor(
    private readonly dbService: DatabaseService,
    @Inject('STORAGE_PORT') private readonly storage: StoragePort,
  ) {}

  /**
   * Ingest raw text or markdown document directly.
   */
  async ingestText(projectId: string, input: IngestTextInput) {
    if (!input.text || input.text.trim().length === 0) {
      throw new BadRequestException('Document text cannot be empty');
    }

    const buffer = Buffer.from(input.text, 'utf-8');
    if (buffer.length > this.MAX_SIZE_BYTES) {
      throw new BadRequestException('Document text exceeds 20MB limit');
    }

    await this.assertDocumentCountLimit(projectId);

    const filename = input.filename || `document_${Date.now()}.txt`;
    const kind = input.kind || 'text';

    return this.saveDocument(projectId, buffer, filename, 'text/plain; charset=utf-8', kind);
  }

  /**
   * Ingest file buffer (.pdf, .docx, .txt, .md, .eml).
   * Rejects scanned/image-only PDFs with 422 Unprocessable Entity (FR-ING-008).
   */
  async ingestFile(projectId: string, input: IngestFileInput) {
    if (!input.buffer || input.buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }

    if (input.buffer.length > this.MAX_SIZE_BYTES) {
      throw new BadRequestException(
        `File size exceeds 20MB limit (size: ${Math.round(input.buffer.length / 1024 / 1024)}MB)`,
      );
    }

    const allowedExtensions = ['.pdf', '.docx', '.txt', '.md', '.eml', '.json'];
    const ext = input.filename.includes('.')
      ? input.filename.substring(input.filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!allowedExtensions.includes(ext) && !input.mimeType.startsWith('text/')) {
      throw new BadRequestException(
        `Unsupported file type '${ext || input.mimeType}'. Supported formats: PDF, DOCX, TXT, Markdown, EML.`,
      );
    }

    await this.assertDocumentCountLimit(projectId);

    // Pre-flight validate binary PDFs so scanned PDFs or corrupt binaries fail fast with actionable feedback (FR-ING-008)
    if (ext === '.pdf' || input.mimeType === 'application/pdf') {
      try {
        const tempParser = new S1ParseAndSegment(new CoverageLedger());
        await tempParser.process({
          documentId: '00000000-0000-0000-0000-000000000000',
          content: input.buffer,
          contentType: 'application/pdf',
        });
      } catch (err: any) {
        if (err instanceof ScannedPdfError || err?.name === 'ScannedPdfError') {
          throw new UnprocessableEntityException(err.message);
        }
        throw new UnprocessableEntityException(
          `Could not extract text from PDF '${input.filename}': ${err?.message ?? 'invalid PDF stream'}. Please upload a text-based PDF, DOCX, or Markdown file.`,
        );
      }
    }

    // Determine document kind from filename or mime
    let kind = input.kind;
    if (!kind) {
      if (ext === '.eml' || input.mimeType.includes('message/rfc822')) {
        kind = 'email';
      } else if (input.filename.toLowerCase().includes('srs') || input.filename.toLowerCase().includes('spec')) {
        kind = 'srs';
      } else {
        kind = 'text';
      }
    }

    return this.saveDocument(projectId, input.buffer, input.filename, input.mimeType, kind);
  }

  /**
   * List all documents uploaded for a project.
   */
  async listDocuments(projectId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      return await this.dbService.db
        .select()
        .from(documents)
        .where(eq(documents.projectId, projectId));
    }

    const list: any[] = [];
    for (const doc of this.dbService.memDocuments.values()) {
      if (doc.projectId === projectId) list.push(doc);
    }
    return list;
  }

  /**
   * Get single document metadata.
   */
  async getDocument(id: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db.select().from(documents).where(eq(documents.id, id)).limit(1);
      if (found.length === 0) throw new NotFoundException(`Document '${id}' not found`);
      return found[0];
    }
    const doc = this.dbService.memDocuments.get(id);
    if (!doc) throw new NotFoundException(`Document '${id}' not found`);
    return doc;
  }

  /**
   * Delete document metadata and stored raw file.
   */
  async deleteDocument(id: string) {
    const doc = await this.getDocument(id);
    await this.storage.delete(doc.s3Key);

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.delete(documents).where(eq(documents.id, id));
    } else {
      this.dbService.memDocuments.delete(id);
    }

    return { deleted: true, id };
  }

  private async assertDocumentCountLimit(projectId: string) {
    const existing = await this.listDocuments(projectId);
    if (existing.length >= this.MAX_DOCS_PER_PROJECT) {
      throw new BadRequestException(
        `Project already has the maximum of ${this.MAX_DOCS_PER_PROJECT} documents. Delete an older document before uploading another.`,
      );
    }
  }

  private async saveDocument(
    projectId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string,
    kind: 'srs' | 'text' | 'email',
  ) {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const documentId = crypto.randomUUID();
    const s3Key = `documents_${projectId}_${sha256.substring(0, 12)}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // Upload untouched original file to storage port (FR-ING-004)
    const uploadResult = await this.storage.upload(buffer, s3Key, mimeType);

    const docRecord = {
      id: documentId,
      projectId,
      kind,
      s3Key: uploadResult.s3Key,
      sha256,
      filename,
      mimeType,
      sizeBytes: buffer.length,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(documents).values(docRecord);
    } else {
      this.dbService.memDocuments.set(documentId, docRecord);
    }

    this.logger.log(
      `Ingested document id=${documentId} for project=${projectId} (kind=${kind}, sha256=${sha256.substring(0, 8)})`,
    );

    return {
      document_id: documentId,
      projectId,
      kind,
      filename,
      size_bytes: buffer.length,
      sha256,
      s3_key: uploadResult.s3Key,
      url: uploadResult.url,
      created_at: docRecord.createdAt.toISOString(),
    };
  }
}
