import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ArchitectureService } from './architecture.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RateLimitGuard } from '../../guards/rate-limit.guard';
import { ModelPatch } from '@srs-tool/schemas';

@Controller()
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class ArchitectureController {
  constructor(private readonly service: ArchitectureService) {}

  /**
   * GET /models/:id — Get architecture model JSON.
   */
  @Get('models/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  /**
   * GET /projects/:projectId/architecture — Get active architecture model for project.
   */
  @Get('projects/:projectId/architecture')
  findByProject(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  /**
   * POST /projects/:projectId/architecture — Synthesize architecture model and stack.
   */
  @Post('projects/:projectId/architecture')
  synthesize(@Param('projectId') projectId: string) {
    return this.service.synthesizeArchitecture(projectId);
  }

  /**
   * PATCH /models/:id — Apply a model patch with optimistic locking (expected_version).
   */
  @Patch('models/:id')
  applyPatch(@Param('id') id: string, @Body() patch: ModelPatch) {
    return this.service.applyPatch(id, patch);
  }

  /**
   * POST /models/:id/commands — Fixed-syntax model commands (Command Parser, no LLM).
   */
  @Post('models/:id/commands')
  executeCommand(
    @Param('id') id: string,
    @Body() body: { command: string },
  ) {
    return this.service.executeCommand(id, body.command);
  }
}
