import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RateLimitGuard } from '../../guards/rate-limit.guard';

@Controller()
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class ExportsController {
  constructor(private readonly service: ExportsService) {}

  /**
   * POST /projects/:projectId/exports — Create an export package (ZIP / Markdown / CSV / PUML / SVG).
   */
  @Post('projects/:projectId/exports')
  createExport(
    @Param('projectId') projectId: string,
    @Body() body: { formats?: string[] },
  ) {
    return this.service.createExport(projectId, body?.formats);
  }

  /**
   * GET /projects/:projectId/exports — List export history for project.
   */
  @Get('projects/:projectId/exports')
  listExports(@Param('projectId') projectId: string) {
    return this.service.listExports(projectId);
  }

  /**
   * GET /exports/:id — Get export status and presigned download URL.
   */
  @Get('exports/:id')
  getExport(@Param('id') id: string) {
    return this.service.getExport(id);
  }
}
