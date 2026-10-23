import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
// @UseGuards(JwtAuthGuard, QuotaGuard)  // Guards will be added when auth is implemented
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** POST /projects — Create a new project */
  @Post()
  create(@Body() body: { name: string; platforms: string[]; output_language: string }) {
    return this.projectsService.create(body);
  }

  /** GET /projects — List user's projects */
  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  /** GET /projects/:id — Get project details */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  /** GET /projects/:id/coverage — Coverage report */
  @Get(':id/coverage')
  getCoverage(@Param('id') id: string) {
    return this.projectsService.getCoverage(id);
  }

  /** GET /projects/:id/checklist — Platform checklist status */
  @Get(':id/checklist')
  getChecklist(@Param('id') id: string) {
    return this.projectsService.getChecklist(id);
  }

  /** PATCH /projects/:id/checklist/:itemId — Mark checklist item not-applicable */
  @Patch(':id/checklist/:itemId')
  updateChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { not_applicable: boolean; reason?: string },
  ) {
    return this.projectsService.updateChecklistItem(id, itemId, body);
  }

  /** POST /projects/:id/documents — Upload document */
  @Post(':id/documents')
  uploadDocument(@Param('id') id: string, @Body() body: unknown) {
    return this.projectsService.uploadDocument(id, body);
  }

  /** POST /projects/:id/runs — Start pipeline run */
  @Post(':id/runs')
  startRun(
    @Param('id') id: string,
    @Body() body: { mode?: 'eco' | 'standard' | 'thorough'; from_stage?: number },
  ) {
    return this.projectsService.startRun(id, body);
  }

  /** POST /projects/:id/architecture — Synthesize architecture model */
  @Post(':id/architecture')
  synthesizeArchitecture(@Param('id') id: string) {
    return this.projectsService.synthesizeArchitecture(id);
  }

  /** POST /projects/:id/exports — Create export package */
  @Post(':id/exports')
  createExport(
    @Param('id') id: string,
    @Body() body: { formats: string[] },
  ) {
    return this.projectsService.createExport(id, body.formats);
  }
}
