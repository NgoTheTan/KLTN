import type { ArchitectureModel, ArchElement, ArchRelationship, ArchView, ViewType } from '@srs-tool/schemas';

/**
 * PlantUML Generator
 *
 * Pure TypeScript functions — no LLM, no external calls.
 * Takes an ArchitectureModel and generates PlantUML source for any view type.
 *
 * Key property: proper character escaping ensures generated PlantUML
 * almost never has syntax errors. The LLM self-repair loop is only
 * needed for "detached" mode where users edit PlantUML directly.
 */

/** Escape PlantUML special characters in labels/names */
function escape(text: string): string {
  return text
    .replace(/"/g, '\\"')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\n/g, '\\n');
}

/** Wrap text in PlantUML double-quotes if it contains spaces or special chars */
function label(text: string): string {
  const escaped = escape(text);
  return escaped.includes(' ') || escaped.includes('(') ? `"${escaped}"` : escaped;
}

// C4 Context Diagram

export function generateContextDiagram(model: ArchitectureModel): string {
  const lines: string[] = [
    '@startuml',
    '!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml',
    '',
    `title System Context: ${escape(model.elements.find(e => e.kind === 'system')?.name ?? 'System')}`,
    '',
  ];

  for (const el of model.elements) {
    switch (el.kind) {
      case 'person':
        lines.push(`Person(${el.id}, ${label(el.name)}, ${label(el.description ?? '')})`);
        break;
      case 'system':
        lines.push(`System(${el.id}, ${label(el.name)}, ${label(el.description ?? '')})`);
        break;
      default:
        if (!el.parent_id) {
          lines.push(`System_Ext(${el.id}, ${label(el.name)}, ${label(el.description ?? '')})`);
        }
    }
  }

  lines.push('');
  for (const rel of model.relationships) {
    lines.push(`Rel(${rel.source_id}, ${rel.target_id}, ${label(rel.label ?? '')})`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// C4 Container Diagram

export function generateContainerDiagram(model: ArchitectureModel): string {
  const lines: string[] = [
    '@startuml',
    '!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml',
    '',
    `title Container View`,
    '',
  ];

  const containers = model.elements.filter(e => e.kind === 'container');
  const systems = model.elements.filter(e => e.kind === 'system');
  const persons = model.elements.filter(e => e.kind === 'person');

  for (const el of persons) {
    lines.push(`Person(${el.id}, ${label(el.name)}, ${label(el.description ?? '')})`);
  }

  if (systems.length > 0) {
    const mainSystem = systems[0]!;
    lines.push(`System_Boundary(${mainSystem.id}_b, ${label(mainSystem.name)}) {`);
    for (const c of containers) {
      lines.push(`  Container(${c.id}, ${label(c.name)}, ${label(c.technology ?? '')}, ${label(c.description ?? '')})`);
    }
    lines.push('}');
  }

  lines.push('');
  for (const rel of model.relationships) {
    const proto = rel.protocol ? `, ${label(rel.protocol)}` : '';
    lines.push(`Rel(${rel.source_id}, ${rel.target_id}, ${label(rel.label ?? '')}${proto})`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// Sequence Diagram

export function generateSequenceDiagram(
  model: ArchitectureModel,
  sequenceFlow: { title: string; steps: Array<{ from: string; to: string; label: string; async?: boolean }> },
): string {
  const lines: string[] = [
    '@startuml',
    `title ${escape(sequenceFlow.title)}`,
    '',
  ];

  // Declare participants
  const participantIds = new Set(sequenceFlow.steps.flatMap(s => [s.from, s.to]));
  for (const id of participantIds) {
    const el = model.elements.find(e => e.id === id);
    if (el) {
      lines.push(`participant ${label(el.name)} as ${id}`);
    }
  }

  lines.push('');

  for (const step of sequenceFlow.steps) {
    const arrow = step.async ? '->>' : '->';
    lines.push(`${step.from} ${arrow} ${step.to} : ${escape(step.label)}`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// Component Diagram

export function generateComponentDiagram(
  model: ArchitectureModel,
  containerId: string,
): string {
  const lines: string[] = [
    '@startuml',
    '!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Component.puml',
    '',
  ];

  const container = model.elements.find(e => e.id === containerId);
  if (!container) return `@startuml\nnote: Container not found\n@enduml`;

  lines.push(`title Component View: ${escape(container.name)}`);
  lines.push('');
  lines.push(`Container_Boundary(${containerId}_b, ${label(container.name)}) {`);

  const components = model.elements.filter(e => e.kind === 'component' && e.parent_id === containerId);
  for (const c of components) {
    lines.push(`  Component(${c.id}, ${label(c.name)}, ${label(c.technology ?? '')}, ${label(c.description ?? '')})`);
  }
  lines.push('}');

  lines.push('');
  for (const rel of model.relationships) {
    const inScope = components.some(c => c.id === rel.source_id || c.id === rel.target_id);
    if (inScope) {
      lines.push(`Rel(${rel.source_id}, ${rel.target_id}, ${label(rel.label ?? '')})`);
    }
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// ER Diagram

export function generateERDiagram(
  entities: Array<{ name: string; attributes: Array<{ name: string; type: string; isPK?: boolean; isFK?: boolean }> }>,
  relationships: Array<{ from: string; to: string; label: string; cardinality: string }>,
): string {
  const lines: string[] = ['@startuml', ''];

  for (const entity of entities) {
    lines.push(`entity "${escape(entity.name)}" {`);
    for (const attr of entity.attributes) {
      const pk = attr.isPK ? '* ' : '  ';
      const fk = attr.isFK ? ' <<FK>>' : '';
      lines.push(`  ${pk}${attr.name} : ${attr.type}${fk}`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const rel of relationships) {
    lines.push(`"${escape(rel.from)}" ${rel.cardinality} "${escape(rel.to)}" : ${escape(rel.label)}`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// Dispatcher

/** Generate PlantUML for any view type from the architecture model. */
export function generateDiagram(
  model: ArchitectureModel,
  viewType: ViewType,
  options?: { containerId?: string; sequenceFlowId?: string },
): string {
  switch (viewType) {
    case 'context':
      return generateContextDiagram(model);
    case 'container':
      return generateContainerDiagram(model);
    case 'component':
      return generateComponentDiagram(model, options?.containerId ?? '');
    case 'sequence':
      // Sequence flow data would be passed separately
      return '@startuml\nnote: Sequence flow data required\n@enduml';
    case 'er':
      return '@startuml\nnote: ER entities data required\n@enduml';
    default:
      return '@startuml\nnote: View type not yet implemented\n@enduml';
  }
}
