import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequirementsService } from './requirements.service';

@Controller('projects/:projectId/requirements')
export class RequirementsController {
  constructor(private readonly service: RequirementsService) {}

  /** GET /projects/:projectId/requirements — List with filters */
  @Get()
  findAll(
    @Param('projectId') projectId: string,
    @Query('type') type?: string,
    @Query('platform') platform?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(projectId, { type, platform, status });
  }

  /** GET /projects/:projectId/requirements/:id — Single requirement with history */
  @Get(':id')
  findOne(@Param('projectId') projectId: string, @Param('id') id: string) {
    return this.service.findOne(projectId, id);
  }
}
