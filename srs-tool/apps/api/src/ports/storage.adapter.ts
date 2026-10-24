import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoragePort, UploadResult } from './index';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private uploadDir: string;

  constructor(private readonly config: ConfigService) {
    this.uploadDir = path.resolve(process.cwd(), '.uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async upload(buffer: Buffer, key: string, contentType: string): Promise<UploadResult> {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(this.uploadDir, safeKey);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, buffer);
    const url = `/api/v1/storage/files/${safeKey}`;
    this.logger.log(`Uploaded file ${key} (${buffer.length} bytes, sha256=${sha256.substring(0, 8)})`);

    return {
      s3Key: safeKey,
      url,
      sha256,
    };
  }

  async presignedUrl(s3Key: string, ttlSeconds: number): Promise<string> {
    // In local dev, return the direct endpoint with an expiry timestamp query
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `/api/v1/storage/files/${encodeURIComponent(s3Key)}?expires=${expiry}`;
  }

  async delete(s3Key: string): Promise<void> {
    const filePath = path.join(this.uploadDir, s3Key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
