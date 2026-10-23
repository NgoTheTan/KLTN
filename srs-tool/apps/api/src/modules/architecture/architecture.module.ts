import { Module } from '@nestjs/common';
import { ArchitectureController } from './architecture.controller';
import { ArchitectureService } from './architecture.service';

@Module({ controllers: [ArchitectureController], providers: [ArchitectureService], exports: [ArchitectureService] })
export class ArchitectureModule {}
