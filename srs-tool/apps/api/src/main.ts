import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  app.setGlobalPrefix('api/v1');

  await app.listen(process.env['PORT'] ?? 3001, '0.0.0.0');
  console.log(`API server running on http://0.0.0.0:${process.env['PORT'] ?? 3001}`);
}

bootstrap();
