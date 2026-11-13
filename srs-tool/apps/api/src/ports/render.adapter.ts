import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RenderPort, RenderResult } from './index';

interface ParsedElement {
  id: string;
  name: string;
  type: string;
  tech?: string;
  desc?: string;
  inBoundary: boolean;
}

interface ParsedRel {
  from: string;
  to: string;
  label: string;
  tech?: string;
}

@Injectable()
export class PlantUMLRenderAdapter implements RenderPort {
  private readonly logger = new Logger(PlantUMLRenderAdapter.name);
  private readonly plantumlUrl: string;

  constructor(private readonly config?: ConfigService) {
    this.plantumlUrl = this.config?.get<string>('PLANTUML_URL') ?? process.env['PLANTUML_URL'] ?? 'http://localhost:8080';
  }

  async render(puml: string, format: 'svg' | 'png'): Promise<RenderResult> {
    try {
      // Attempt HTTP request to air-gapped PlantUML server
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
      // PlantUML server offline or timed out -> use deterministic C4 SVG renderer
      this.logger.debug(`PlantUML server unreachable (${err?.message}). Using deterministic C4 fallback SVG.`);
      return {
        svg: this.generateFallbackSvg(puml),
      };
    }
  }

  /**
   * High-clarity deterministic C4 SVG renderer when the Docker PlantUML server is offline.
   * Parses C4 macros (`Person`, `System`, `System_Ext`, `Container`, `ContainerDb`, `Component`,
   * `System_Boundary`, `Container_Boundary`, and `Rel*`) and renders nodes, boundary box, and directed edges.
   */
  generateFallbackSvg(puml: string, notice?: string): string {
    const lines = puml.split('\n');
    const titleLine = lines.find((l) => l.trim().startsWith('title '));
    const title = titleLine ? titleLine.trim().replace(/^title\s+/, '') : 'C4 Architecture Diagram';

    const elements: ParsedElement[] = [];
    const relationships: ParsedRel[] = [];
    let boundaryDepth = 0;
    let boundaryTitle = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("'") || line.startsWith('!include')) continue;

      const boundaryMatch = line.match(/^(?:System_Boundary|Container_Boundary)\s*\(\s*[A-Za-z0-9_]+\s*,\s*"([^"]+)"\s*\)\s*\{?/);
      if (boundaryMatch) {
        boundaryDepth++;
        boundaryTitle = boundaryMatch[1] ?? 'System Boundary';
        continue;
      }
      if (line === '}' && boundaryDepth > 0) {
        boundaryDepth--;
        continue;
      }

      const argsMatch = line.match(/^([A-Za-z0-9_]+)\s*\((.+)\)$/);
      if (!argsMatch) continue;
      const macro = argsMatch[1]!;
      const rawArgs = argsMatch[2]!;
      const parts = this.splitMacroArgs(rawArgs);
      if (parts.length < 2) continue;

      if (macro.startsWith('Rel')) {
        relationships.push({
          from: parts[0]!,
          to: parts[1]!,
          label: parts[2] ?? '',
          tech: parts[3],
        });
      } else if (
        ['Person', 'Person_Ext', 'System', 'System_Ext', 'Container', 'ContainerDb', 'ContainerQueue', 'Component', 'ComponentDb'].includes(macro)
      ) {
        const hasTech = macro.startsWith('Container') || macro.startsWith('Component');
        elements.push({
          id: parts[0]!,
          name: parts[1] ?? parts[0]!,
          type: macro,
          tech: hasTech ? parts[2] : undefined,
          desc: hasTech ? parts[3] : parts[2],
          inBoundary: boundaryDepth > 0,
        });
      }
    }

    if (elements.length === 0) {
      return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 280" width="100%" height="100%" style="background-color: #0f172a;">
  <text x="30" y="42" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="18" font-weight="bold">${this.escapeXml(title)}</text>
  ${notice ? `<text x="30" y="66" fill="#f59e0b" font-family="system-ui, sans-serif" font-size="12">${this.escapeXml(notice)}</text>` : ''}
  <rect x="30" y="84" width="760" height="165" rx="8" fill="#1e293b" stroke="#475569" stroke-width="1"/>
  <text x="50" y="118" fill="#94a3b8" font-family="monospace" font-size="12">${this.escapeXml(puml.slice(0, 180))}</text>
</svg>`.trim();
    }

    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(elements.length))));
    const cardW = 240;
    const cardH = 82;
    const gapX = 56;
    const gapY = 64;
    const padX = 48;
    const topY = notice ? 105 : 88;

    const coords = new Map<string, { x: number; y: number }>();
    elements.forEach((el, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      coords.set(el.id, {
        x: padX + col * (cardW + gapX),
        y: topY + row * (cardH + gapY),
      });
    });

    const totalRows = Math.ceil(elements.length / cols);
    const width = Math.max(820, padX * 2 + cols * cardW + (cols - 1) * gapX);
    const height = Math.max(360, topY + totalRows * cardH + Math.max(0, totalRows - 1) * gapY + 60);

    // Optional boundary box around boundary elements
    const boundaryCoords = elements.filter((e) => e.inBoundary).map((e) => coords.get(e.id)!);
    let boundarySvg = '';
    if (boundaryCoords.length > 0) {
      const minX = Math.min(...boundaryCoords.map((c) => c.x)) - 18;
      const minY = Math.min(...boundaryCoords.map((c) => c.y)) - 26;
      const maxX = Math.max(...boundaryCoords.map((c) => c.x)) + cardW + 18;
      const maxY = Math.max(...boundaryCoords.map((c) => c.y)) + cardH + 16;
      boundarySvg = `
  <rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" rx="10" fill="none" stroke="#64748b" stroke-width="1.5" stroke-dasharray="6 4"/>
  <text x="${minX + 12}" y="${minY + 16}" fill="#cbd5e1" font-size="11" font-weight="600">${this.escapeXml(boundaryTitle || 'System Boundary')}</text>`;
    }

    let edgesSvg = '';
    for (const rel of relationships) {
      const src = coords.get(rel.from);
      const dst = coords.get(rel.to);
      if (!src || !dst) continue;
      const x1 = src.x + cardW / 2;
      const y1 = src.y + cardH / 2;
      const x2 = dst.x + cardW / 2;
      const y2 = dst.y + cardH / 2;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const edgeLabel = rel.tech ? `${rel.label} [${rel.tech}]` : rel.label;
      edgesSvg += `
  <g class="c4-edge">
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.6" marker-end="url(#c4-arrow)"/>
    ${edgeLabel ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" fill="#cbd5e1" font-size="10.5">${this.escapeXml(edgeLabel.slice(0, 38))}</text>` : ''}
  </g>`;
    }

    let nodesSvg = '';
    for (const el of elements) {
      const pos = coords.get(el.id)!;
      const palette = this.getPalette(el.type);
      const subtitle = el.tech ? `[${el.type}: ${el.tech}]` : `[${el.type}]`;
      const desc = (el.desc ?? '').slice(0, 42);
      nodesSvg += `
  <g class="c4-node" data-element-id="${this.escapeXml(el.id)}" transform="translate(${pos.x}, ${pos.y})">
    <rect width="${cardW}" height="${cardH}" rx="8" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2"/>
    <text x="${cardW / 2}" y="26" text-anchor="middle" fill="#f8fafc" font-weight="700" font-size="13.5">${this.escapeXml(el.name.slice(0, 30))}</text>
    <text x="${cardW / 2}" y="45" text-anchor="middle" fill="${palette.badge}" font-size="11">${this.escapeXml(subtitle.slice(0, 36))}</text>
    ${desc ? `<text x="${cardW / 2}" y="64" text-anchor="middle" fill="#cbd5e1" font-size="10.5">${this.escapeXml(desc)}</text>` : ''}
  </g>`;
    }

    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background-color: #0f172a;">
  <defs>
    <marker id="c4-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8"/>
    </marker>
  </defs>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
  <text x="32" y="42" fill="#38bdf8" font-size="19" font-weight="700">${this.escapeXml(title)}</text>
  ${notice ? `<text x="32" y="64" fill="#f59e0b" font-size="12">${this.escapeXml(notice)}</text>` : ''}
  ${boundarySvg}
  ${edgesSvg}
  ${nodesSvg}
</svg>`.trim();
  }

  private splitMacroArgs(raw: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]!;
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim().length > 0 || raw.endsWith(',')) {
      result.push(current.trim());
    }
    return result;
  }

  private getPalette(type: string): { fill: string; stroke: string; badge: string } {
    if (type.startsWith('Person')) return { fill: '#0c4a6e', stroke: '#38bdf8', badge: '#7dd3fc' };
    if (type === 'System_Ext') return { fill: '#334155', stroke: '#94a3b8', badge: '#cbd5e1' };
    if (type === 'System') return { fill: '#1e3a8a', stroke: '#60a5fa', badge: '#93c5fd' };
    if (type.endsWith('Db')) return { fill: '#134e4a', stroke: '#2dd4bf', badge: '#5eead4' };
    if (type.startsWith('Component')) return { fill: '#312e81', stroke: '#818cf8', badge: '#a5b4fc' };
    return { fill: '#1e293b', stroke: '#38bdf8', badge: '#7dd3fc' };
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
