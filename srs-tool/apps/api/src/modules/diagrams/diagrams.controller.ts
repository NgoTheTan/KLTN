import { Controller, Get, Put, Post, Param, Query, Body, UseGuards, Res } from '@nestjs/common';
import { DiagramsService } from './diagrams.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RateLimitGuard } from '../../guards/rate-limit.guard';

@Controller()
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class DiagramsController {
  constructor(private readonly service: DiagramsService) {}

  /**
   * GET /diagrams/:id?format=svg|png|puml — Get diagram in requested format.
   */
  @Get('diagrams/:id')
  async getDiagram(
    @Param('id') id: string,
    @Query('format') format: 'svg' | 'png' | 'puml' = 'svg',
    @Res() res: any,
  ) {
    const result = await this.service.getDiagram(id, format);

    if (format === 'svg') {
      res.header('Content-Type', 'image/svg+xml; charset=utf-8');
      return res.send(result.svg);
    }

    if (format === 'png' && result.png) {
      res.header('Content-Type', 'image/png');
      return res.send(result.png);
    }

    return res.send(result);
  }

  /**
   * PUT /diagrams/:id/puml — Update PlantUML code directly in detached mode.
   */
  @Put('diagrams/:id/puml')
  updatePuml(@Param('id') id: string, @Body() body: { puml: string }) {
    return this.service.updatePuml(id, body.puml);
  }

  /**
   * POST /diagrams/:id/reset — Switch back from detached mode to model mode.
   */
  @Post('diagrams/:id/reset')
  resetToModel(@Param('id') id: string) {
    return this.service.resetToModel(id);
  }

  /**
   * GET /models/:modelId/diagrams — List diagram views available for a model.
   */
  @Get('models/:modelId/diagrams')
  listDiagrams(@Param('modelId') modelId: string) {
    return this.service.listDiagrams(modelId);
  }
}
