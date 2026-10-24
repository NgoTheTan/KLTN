import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  RequirementsService,
  RequirementFilters,
  CreateRequirementDto,
} from './requirements.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RateLimitGuard } from '../../guards/rate-limit.guard';

@Controller()
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class RequirementsController {
  constructor(private readonly service: RequirementsService) {}

  /**
   * GET /projects/:projectId/requirements — List requirements with filters.
   */
  @Get('projects/:projectId/requirements')
  findAll(
    @Param('projectId') projectId: string,
    @Query('type') type?: string,
    @Query('platform') platform?: string,
    @Query('status') status?: string,
    @Query('ears_pattern') ears_pattern?: string,
    @Query('is_asr') is_asr?: string,
    @Query('min_quality_score') min_quality_score?: string,
    @Query('search') search?: string,
  ) {
    const filters: RequirementFilters = {
      type,
      platform,
      status,
      ears_pattern,
      is_asr: is_asr !== undefined ? is_asr === 'true' : undefined,
      min_quality_score: min_quality_score ? parseInt(min_quality_score) : undefined,
      search,
    };
    return this.service.findAll(projectId, filters);
  }

  /**
   * GET /projects/:projectId/requirements/:id — Requirement details with sources & versions.
   */
  @Get('projects/:projectId/requirements/:id')
  findOne(@Param('projectId') projectId: string, @Param('id') id: string) {
    return this.service.findOne(projectId, id);
  }

  /**
   * POST /projects/:projectId/requirements — Manually create requirement.
   */
  @Post('projects/:projectId/requirements')
  create(
    @Param('projectId') projectId: string,
    @Body() body: CreateRequirementDto,
    @Req() req: any,
  ) {
    const changedBy = req.user?.email || 'user';
    return this.service.create(projectId, body, changedBy);
  }

  /**
   * PATCH /projects/:projectId/requirements/:id — Update requirement with version increment.
   */
  @Patch('projects/:projectId/requirements/:id')
  update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: Partial<CreateRequirementDto>,
    @Req() req: any,
  ) {
    const changedBy = req.user?.email || 'user';
    return this.service.update(projectId, id, body, changedBy);
  }

  /**
   * POST /requirements/:id/revert — Revert to specific past version.
   */
  @Post('requirements/:id/revert')
  revert(
    @Param('id') id: string,
    @Body() body: { projectId: string; version: number },
  ) {
    return this.service.revert(body.projectId, id, body.version);
  }

  /**
   * GET /requirements/:id/diff — Diff two versions of a requirement.
   */
  @Get('requirements/:id/diff')
  diff(
    @Param('id') id: string,
    @Query('projectId') projectId: string,
    @Query('v1') v1: string,
    @Query('v2') v2: string,
  ) {
    return this.service.diff(projectId, id, parseInt(v1), parseInt(v2));
  }

  /**
   * GET /projects/:projectId/questions — Clarification questions list.
   */
  @Get('projects/:projectId/questions')
  getQuestions(@Param('projectId') projectId: string) {
    return this.service.getQuestions(projectId);
  }

  /**
   * POST /questions/:id/answer — Answer clarification question.
   */
  @Post('questions/:id/answer')
  answerQuestion(
    @Param('id') id: string,
    @Body() body: { answer: string; skip?: boolean },
  ) {
    return this.service.answerQuestion(id, body.answer, body.skip);
  }

  /**
   * GET /projects/:projectId/glossary — Bilingual glossary terms.
   */
  @Get('projects/:projectId/glossary')
  getGlossary(@Param('projectId') projectId: string) {
    return this.service.getGlossary(projectId);
  }

  /**
   * POST /projects/:projectId/glossary — Add bilingual glossary term.
   */
  @Post('projects/:projectId/glossary')
  addGlossaryTerm(
    @Param('projectId') projectId: string,
    @Body() body: { term_vi: string; term_en: string; definition: string },
  ) {
    return this.service.addGlossaryTerm(projectId, body);
  }
}
