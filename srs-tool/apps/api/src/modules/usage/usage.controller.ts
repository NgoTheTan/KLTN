import { Controller, Get } from '@nestjs/common';
import { UsageService } from './usage.service';

@Controller('me')
export class UsageController {
  constructor(private readonly service: UsageService) {}

  /** GET /me/usage — Current user quota and usage */
  @Get('usage')
  getUsage() {
    return this.service.getCurrentUsage();
  }
}
