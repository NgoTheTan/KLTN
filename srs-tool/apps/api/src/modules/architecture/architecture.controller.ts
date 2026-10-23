import { Controller, Get, Patch, Post, Param, Body } from '@nestjs/common';
import { ArchitectureService } from './architecture.service';

@Controller('models')
export class ArchitectureController {
  constructor(private readonly service: ArchitectureService) {}

  /** GET /models/:id — Get architecture model */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  /** PATCH /models/:id — Apply a model patch */
  @Patch(':id')
  applyPatch(@Param('id') id: string, @Body() patch: unknown) {
    return this.service.applyPatch(id, patch);
  }

  /** POST /models/:id/commands — Fixed-syntax model commands (no LLM) */
  @Post(':id/commands')
  executeCommand(@Param('id') id: string, @Body() body: { command: string; args: unknown }) {
    return this.service.executeCommand(id, body.command, body.args);
  }
}
