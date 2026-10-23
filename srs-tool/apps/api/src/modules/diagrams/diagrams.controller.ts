import { Controller, Get, Param, Query } from '@nestjs/common';
import { DiagramsService } from './diagrams.service';

@Controller('diagrams')
export class DiagramsController {
  constructor(private readonly service: DiagramsService) {}

  /** GET /diagrams/:id?format=svg|png|puml */
  @Get(':id')
  getDiagram(
    @Param('id') id: string,
    @Query('format') format: 'svg' | 'png' | 'puml' = 'svg',
  ) {
    return this.service.getDiagram(id, format);
  }
}
