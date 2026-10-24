import { Global, Module } from '@nestjs/common';
import { LocalStorageAdapter } from './storage.adapter';
import { BullMQQueueAdapter } from './queue.adapter';
import { PlantUMLRenderAdapter } from './render.adapter';

@Global()
@Module({
  providers: [
    LocalStorageAdapter,
    BullMQQueueAdapter,
    PlantUMLRenderAdapter,
    {
      provide: 'STORAGE_PORT',
      useExisting: LocalStorageAdapter,
    },
    {
      provide: 'QUEUE_PORT',
      useExisting: BullMQQueueAdapter,
    },
    {
      provide: 'RENDER_PORT',
      useExisting: PlantUMLRenderAdapter,
    },
  ],
  exports: [
    LocalStorageAdapter,
    BullMQQueueAdapter,
    PlantUMLRenderAdapter,
    'STORAGE_PORT',
    'QUEUE_PORT',
    'RENDER_PORT',
  ],
})
export class PortsModule {}
