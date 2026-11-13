import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoragePort, UploadResult } from './index';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves the shared `.uploads` directory across monorepo apps (`api` and `worker`).
 * Walks upward from `__dirname` / `process.cwd()` to locate `pnpm-workspace.yaml` unless `UPLOAD_DIR` is explicitly set.
 */
export function resolveUploadDir(explicitDir?: string): string {
  const configured = explicitDir ?? process.env['UPLOAD_DIR'];
  if (configured && configured.trim().length > 0) {
    const resolved = path.resolve(configured);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
  }

  let cursor = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(cursor, 'pnpm-workspace.yaml'))) {
      const rootUploads = path.join(cursor, '.uploads');
      if (!fs.existsSync(rootUploads)) {
        fs.mkdirSync(rootUploads, { recursive: true });
      }
      return rootUploads;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const fallback = path.resolve(process.cwd(), '.uploads');
  if (!fs.existsSync(fallback)) {
    fs.mkdirSync(fallback, { recursive: true });
  }
  return fallback;
}

@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly uploadDir: string;

  constructor(private readonly config?: ConfigService) {
    this.uploadDir = resolveUploadDir(this.config?.get<string>('UPLOAD_DIR'));
  }

  /**
   * Resolves a key safely inside `uploadDir` and prevents path traversal (`..`, `/`, `\`).
   */
  getFilePath(s3Key: string): string {
    if (!s3Key || s3Key.includes('..') || s3Key.includes('/') || s3Key.includes('\\')) {
      throw new BadRequestException('Invalid storage key');
    }
    const resolved = path.resolve(this.uploadDir, s3Key);
    const relative = path.relative(this.uploadDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('Storage path traversal blocked');
    }
    return resolved;
  }

  async upload(buffer: Buffer, key: string, _contentType: string): Promise<UploadResult> {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = this.getFilePath(safeKey);

    fs.writeFileSync(filePath, buffer);
    const url = `/api/v1/storage/files/${encodeURIComponent(safeKey)}`;
    this.logger.log(`Uploaded file ${safeKey} (${buffer.length} bytes, sha256=${sha256.substring(0, 8)})`);

    return {
      s3Key: safeKey,
      url,
      sha256,
    };
  }

  async readFile(s3Key: string): Promise<Buffer> {
    const filePath = this.getFilePath(s3Key);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Stored file '${s3Key}' not found`);
    }
    return fs.readFileSync(filePath);
  }

  async presignedUrl(s3Key: string, ttlSeconds: number): Promise<string> {
    const safeKey = s3Key.replace(/[^a-zA-Z0-9._-]/g, '_');
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `/api/v1/storage/files/${encodeURIComponent(safeKey)}?expires=${expiry}`;
  }

  async delete(s3Key: string): Promise<void> {
    const safeKey = s3Key.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = this.getFilePath(safeKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
