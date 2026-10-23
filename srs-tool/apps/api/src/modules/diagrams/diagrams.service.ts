import { Injectable } from '@nestjs/common';

@Injectable()
export class DiagramsService {
  // TODO: Generate PlantUML from model (via plantuml-gen package),
  // call PlantUML render service, cache SVG by content hash
  async getDiagram(id: string, format: string) {
    return { id, format, url: `/diagrams/${id}.${format}` };
  }
}
