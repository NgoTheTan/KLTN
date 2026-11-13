import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  GoneException,
  BadRequestException,
} from '@nestjs/common';
import * as path from 'path';
import { LocalStorageAdapter } from './storage.adapter';

const MIME_BY_EXT: Record<string, string> = {
  '.zip': 'application/zip',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.eml': 'message/rfc822',
  '.json': 'application/json; charset=utf-8',
  '.puml': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Serves locally stored uploads and generated export bundles in offline/local-dev mode.
 * Enforces path-traversal guards and pre-signed URL `expires` timestamps (FR-EXP-005).
 */
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: LocalStorageAdapter) {}

  @Get('files/:key')
  async downloadFile(
    @Param('key') rawKey: string,
    @Query('expires') expires: string | undefined,
    @Res() res: any,
  ) {
    const decodedKey = decodeURIComponent(rawKey || '');
    if (!decodedKey || decodedKey.includes('..') || decodedKey.includes('/') || decodedKey.includes('\\')) {
      throw new BadRequestException('Invalid storage key');
    }

    if (expires !== undefined) {
      const expiryEpoch = Number(expires);
      if (!Number.isFinite(expiryEpoch) || Math.floor(Date.now() / 1000) > expiryEpoch) {
        throw new GoneException('This download link has expired. Please request a fresh download URL.');
      }
    }

    const buffer = await this.storage.readFile(decodedKey);
    const ext = path.extname(decodedKey).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';

    res.header('Content-Type', contentType);
    res.header('Content-Length', String(buffer.length));
    res.header('Content-Disposition', `attachment; filename="${decodedKey.replace(/"/g, '')}"`);
    return res.send(buffer);
  }
}
