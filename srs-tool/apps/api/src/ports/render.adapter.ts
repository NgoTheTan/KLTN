import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RenderPort, RenderResult } from './index';

@Injectable()
export class PlantUMLRenderAdapter implements RenderPort {
  private readonly logger = new Logger(PlantUMLRenderAdapter.name);
  private plantumlUrl: string;

  constructor(private readonly config: ConfigService) {
    this.plantumlUrl = this.config.get<string>('PLANTUML_URL') ?? 'http://localhost:8080';
  }

  async render(puml: string, format: 'svg' | 'png'): Promise<RenderResult> {
    try {
      // Attempt HTTP request to PlantUML server
      const url = `${this.plantumlUrl}/${format}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: puml,
        signal: AbortSignal.timeout(4000),
      });

      if (response.ok) {
        if (format === 'svg') {
          const svg = await response.text();
          return { svg };
        } else {
          const arrayBuffer = await response.arrayBuffer();
          return { png: Buffer.from(arrayBuffer) };
        }
      }

      const errorText = await response.text();
      this.logger.warn(`PlantUML server error: ${response.status} ${errorText}`);
      return {
        error: errorText || `PlantUML error status: ${response.status}`,
        svg: this.generateFallbackSvg(puml, `Render Server Notice: ${response.statusText}`),
      };
    } catch (err: any) {
      // PlantUML server offline or timed out -> use high quality deterministic SVG fallback
      this.logger.debug(`PlantUML server unreachable (${err.message}). Using deterministic fallback SVG.`);
      return {
        svg: this.generateFallbackSvg(puml),
      };
    }
  }

  private generateFallbackSvg(puml: string, notice?: string): string {
    // Extract elements and titles from PlantUML text
    const lines = puml.split('\n');
    const titleLine = lines.find((l) => l.trim().startsWith('title '));
    const title = titleLine ? titleLine.replace('title ', '').trim() : 'Architecture Diagram';

    const elements: { name: string; type: string; desc?: string }[] = [];
    const relationships: { from: string; to: string; label?: string }[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Match C4 macros: Person(id, "Name", "Desc") or Container(id, "Name", "Tech", "Desc")
      const macroMatch = line.match(/^([A-Za-z0-9_]+)\s*\(\s*([A-Za-z0-9_]+)\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]*)")?(?:\s*,\s*"([^"]*)")?\s*\)/);
      if (macroMatch) {
        const [, macro, , name, param3, param4] = macroMatch;
        if (macro.startsWith('Rel')) {
          relationships.push({ from: name, to: param3 || '', label: param4 });
        } else {
          elements.push({ name, type: macro, desc: param4 || param3 });
        }
      }
    }

    const width = 800;
    const itemHeight = 60;
    const height = Math.max(300, 100 + elements.length * (itemHeight + 20));

    let svgElements = '';
    let y = 80;
    for (const el of elements) {
      svgElements += `
        <g transform="translate(50, ${y})">
          <rect width="320" height="${itemHeight}" rx="8" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
          <text x="15" y="25" fill="#f8fafc" font-family="system-ui, sans-serif" font-weight="600" font-size="14">${this.escapeXml(el.name)}</text>
          <text x="15" y="45" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="12">[${this.escapeXml(el.type)}] ${this.escapeXml(el.desc || '')}</text>
        </g>
      `;
      y += itemHeight + 20;
    }

    if (elements.length === 0) {
      svgElements = `
        <rect x="50" y="80" width="700" height="160" rx="8" fill="#1e293b" stroke="#475569" stroke-width="1"/>
        <text x="70" y="115" fill="#e2e8f0" font-family="monospace" font-size="13">@startuml</text>
        <text x="70" y="145" fill="#38bdf8" font-family="monospace" font-size="13">${this.escapeXml(puml.slice(0, 150))}...</text>
        <text x="70" y="175" fill="#e2e8f0" font-family="monospace" font-size="13">@enduml</text>
      `;
    }

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background-color: #0f172a;">
        <style>
          text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        </style>
        <text x="30" y="45" fill="#38bdf8" font-size="20" font-weight="bold">${this.escapeXml(title)}</text>
        ${notice ? `<text x="30" y="70" fill="#f59e0b" font-size="12">${this.escapeXml(notice)}</text>` : ''}
        ${svgElements}
      </svg>
    `.trim();
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
