import { Controller, Post, Get, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RateLimitGuard } from '../../guards/rate-limit.guard';

@Controller()
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class IngestionController {
  constructor(private readonly service: IngestionService) {}

  /**
   * POST /projects/:projectId/documents — Ingest document (text, markdown, or base64 file).
   */
  @Post('projects/:projectId/documents')
  async uploadDocument(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      text?: string;
      contentBase64?: string;
      filename?: string;
      mimeType?: string;
      kind?: 'srs' | 'text' | 'email';
    },
  ) {
    if (body.contentBase64) {
      const buffer = Buffer.from(body.contentBase64, 'base64');
      return this.service.ingestFile(projectId, {
        buffer,
        filename: body.filename || `upload_${Date.now()}.bin`,
        mimeType: body.mimeType || 'application/octet-stream',
        kind: body.kind,
      });
    }

    if (body.text !== undefined) {
      return this.service.ingestText(projectId, {
        text: body.text,
        kind: body.kind,
        filename: body.filename,
      });
    }

    throw new BadRequestException('Request body must contain either "text" or "contentBase64"');
  }

  /**
   * GET /projects/:projectId/documents — List all ingested documents for project.
   */
  @Get('projects/:projectId/documents')
  listDocuments(@Param('projectId') projectId: string) {
    return this.service.listDocuments(projectId);
  }

  /**
   * GET /documents/:id — Get document details.
   */
  @Get('documents/:id')
  getDocument(@Param('id') id: string) {
    return this.service.getDocument(id);
  }
}
