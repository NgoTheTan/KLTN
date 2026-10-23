import { Controller } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
@Controller('ingestion')
export class IngestionController { constructor(private readonly service: IngestionService) {} }
