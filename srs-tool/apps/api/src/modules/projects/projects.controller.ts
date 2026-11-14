import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  Sse,
} from '@nestjs/common';
import { ProjectsService, CreateProjectDto } from './projects.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { QuotaGuard } from '../../guards/quota.guard';
import { RateLimitGuard } from '../../guards/rate-limit.guard';
import { Observable } from 'rxjs';

@Controller()
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * POST /projects — Create a new project.
   */
  @Post('projects')
  create(@Req() req: any, @Body() body: CreateProjectDto) {
    const ownerId = req.user?.id || '00000000-0000-0000-0000-000000000001';
    return this.projectsService.create(body, ownerId);
  }

  /**
   * GET /projects — List projects for authenticated user.
   */
  @Get('projects')
  findAll(@Req() req: any) {
    const ownerId = req.user?.id || '00000000-0000-0000-0000-000000000001';
    return this.projectsService.findAll(ownerId);
  }

  /**
   * GET /projects/:id — Get project details and coverage summary.
   */
  @Get('projects/:id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.projectsService.findOne(id, req.user?.id);
  }

  /**
   * PATCH /projects/:id — Update project settings.
   */
  @Patch('projects/:id')
  update(@Param('id') id: string, @Body() body: Partial<CreateProjectDto>, @Req() req: any) {
    return this.projectsService.update(id, body, req.user?.id);
  }

  /**
   * DELETE /projects/:id — Delete project.
   */
  @Delete('projects/:id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.projectsService.delete(id, req.user?.id);
  }

  /**
   * GET /projects/:id/coverage — Get Coverage Ledger report.
   */
  @Get('projects/:id/coverage')
  getCoverage(@Param('id') id: string) {
    return this.projectsService.getCoverage(id);
  }

  /**
   * GET /projects/:id/segments — List segments with linked requirements for Coverage Ledger UI.
   */
  @Get('projects/:id/segments')
  getSegments(@Param('id') id: string, @Req() req: any) {
    return this.projectsService.getSegments(id, req.user?.id);
  }

  /**
   * GET /projects/:id/runs — List runs for project.
   */
  @Get('projects/:id/runs')
  listRuns(@Param('id') id: string, @Req() req: any) {
    return this.projectsService.listRuns(id, req.user?.id);
  }

  /**
   * GET /projects/:id/checklist — Platform checklist status.
   */
  @Get('projects/:id/checklist')
  getChecklist(@Param('id') id: string) {
    return this.projectsService.getChecklist(id);
  }

  /**
   * PATCH /projects/:id/checklist/:itemId — Mark checklist item as not-applicable.
   */
  @Patch('projects/:id/checklist/:itemId')
  updateChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { not_applicable: boolean; reason?: string },
  ) {
    return this.projectsService.updateChecklistItem(id, itemId, body);
  }

  /**
   * POST /projects/:id/lock-baseline — Lock requirement baseline after 100% coverage & confirmation gate.
   */
  @Post('projects/:id/lock-baseline')
  lockBaseline(@Param('id') id: string, @Req() req: any) {
    return this.projectsService.lockBaseline(id, req.user?.id);
  }

  /**
   * POST /projects/:id/runs — Start a pipeline run (eco, standard, thorough).
   */
  @Post('projects/:id/runs')
  @UseGuards(QuotaGuard)
  startRun(
    @Param('id') id: string,
    @Body() body: { mode?: 'eco' | 'standard' | 'thorough'; from_stage?: number },
    @Req() req: any,
  ) {
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000001';
    return this.projectsService.startRun(id, body, userId);
  }

  /**
   * GET /runs/:id — Get run status and progress.
   */
  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.projectsService.getRun(id);
  }

  /**
   * GET /runs/:id/events — Server-Sent Events stream for run progress.
   */
  @Sse('runs/:id/events')
  getRunEvents(@Param('id') id: string): Observable<{ data: string }> {
    return this.projectsService.getRunEventStream(id);
  }

  /**
   * GET /runs/:id/decisions — Tier statistics and decision log entries.
   */
  @Get('runs/:id/decisions')
  getRunDecisions(@Param('id') id: string) {
    return this.projectsService.getRunDecisions(id);
  }

  /**
   * POST /runs/:id/escalate — Escalate pending LLM items when quota is available.
   */
  @Post('runs/:id/escalate')
  escalateRun(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000001';
    return this.projectsService.escalateRun(id, userId);
  }

  /**
   * POST /runs/:id/cancel — Cancel a running or queued pipeline job (FR-RVW-007).
   */
  @Post('runs/:id/cancel')
  cancelRun(@Param('id') id: string) {
    return this.projectsService.cancelRun(id);
  }
}
