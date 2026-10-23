import { Controller } from '@nestjs/common';
import { ExportsService } from './exports.service';
@Controller('exports')
export class ExportsController { constructor(private readonly service: ExportsService) {} }
