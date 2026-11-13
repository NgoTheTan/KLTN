import { describe, it, expect } from 'vitest';
import type { ArchitectureModel } from '@srs-tool/schemas';
import {
  generateContextDiagram,
  generateContainerDiagram,
  generateComponentDiagram,
  generateSequenceDiagram,
  validateSafePuml,
} from './generators.js';

function makeSampleModel(includeSystem: boolean): ArchitectureModel {
  const now = new Date().toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000010',
    project_id: '00000000-0000-4000-8000-000000000020',
    version: 1,
    language: 'vi',
    elements: [
      ...(includeSystem
        ? [
            {
              id: 'smart_farm_sys',
              kind: 'system' as const,
              name: 'Hệ thống Nông nghiệp Thông minh',
              description: 'Quản lý cảm biến & điều khiển tưới tự động',
              requirement_ids: ['FR-IOT-001'],
            },
          ]
        : []),
      {
        id: 'user',
        kind: 'person',
        name: 'Người vận hành',
        description: 'Theo dõi trên Web Dashboard',
        requirement_ids: [],
      },
      {
        id: 'sensor-node',
        kind: 'device',
        name: 'Trạm cảm biến độ ẩm',
        technology: 'ESP32 + MQTT',
        description: 'Gửi dữ liệu mỗi 10 giây',
        requirement_ids: ['FR-IOT-001'],
      },
      {
        id: 'webapp',
        kind: 'container',
        name: 'Web Dashboard',
        technology: 'React + Vite',
        requirement_ids: ['FR-WEB-001'],
      },
      {
        id: 'api',
        kind: 'container',
        name: 'Backend API',
        technology: 'NestJS',
        requirement_ids: ['FR-WEB-001', 'FR-IOT-001'],
      },
      {
        id: 'db',
        kind: 'datastore',
        name: 'PostgreSQL + TimescaleDB',
        technology: 'PostgreSQL 16',
        requirement_ids: ['NFR-IOT-002'],
      },
    ],
    relationships: [
      { id: 'r1', source_id: 'user', target_id: 'webapp', label: 'Truy cập', protocol: 'HTTPS', requirement_ids: [] },
      { id: 'r2', source_id: 'webapp', target_id: 'api', label: 'Gọi REST/SSE', protocol: 'HTTPS', requirement_ids: [] },
      { id: 'r3', source_id: 'sensor-node', target_id: 'api', label: 'Gửi telemetry', protocol: 'MQTT/TLS', requirement_ids: [] },
      { id: 'r4', source_id: 'api', target_id: 'db', label: 'Đọc/ghi dữ liệu', protocol: 'TCP', requirement_ids: [] },
      { id: 'r_dangling', source_id: 'api', target_id: 'ghost_node', label: 'Không tồn tại', requirement_ids: [] },
    ],
    views: [],
    tech_choices: [],
    created_at: now,
    updated_at: now,
  };
}

describe('@srs-tool/plantuml-gen', () => {
  it('uses air-gapped built-in <C4/...> stdlib includes and zero external URLs', () => {
    const model = makeSampleModel(true);
    for (const puml of [
      generateContextDiagram(model),
      generateContainerDiagram(model),
      generateComponentDiagram(model, 'api'),
    ]) {
      expect(puml).not.toContain('http://');
      expect(puml).not.toContain('https://');
      expect(puml).toContain('!include <C4/C4_');
    }
  });

  it('renders Container, ContainerDb, Device, and System_Boundary even when system element is omitted', () => {
    const model = makeSampleModel(false);
    const puml = generateContainerDiagram(model);

    expect(puml).toContain('System_Boundary(');
    expect(puml).toContain('Container(webapp,');
    expect(puml).toContain('Container(api,');
    expect(puml).toContain('ContainerDb(db,');
    expect(puml).toContain('Container(sensor_node,');
    expect(puml).toContain('Rel(sensor_node, api,');
    expect(puml).toContain('Rel(api, db,');
    expect(puml).not.toContain('ghost_node');
  });

  it('rolls internal container relationships up to central System in Context view', () => {
    const model = makeSampleModel(true);
    const puml = generateContextDiagram(model);

    expect(puml).toContain('Person(user,');
    expect(puml).toContain('System(smart_farm_sys,');
    expect(puml).toContain('System_Ext(sensor_node,');
    expect(puml).toContain('Rel(user, smart_farm_sys,');
    expect(puml).toContain('Rel(sensor_node, smart_farm_sys,');
  });

  it('generates Sequence diagram and validates safe vs unsafe PlantUML directives', () => {
    const model = makeSampleModel(true);
    const seq = generateSequenceDiagram(model);
    expect(seq).toContain('participant "Backend API" as api');
    expect(seq).toContain('user -> webapp');

    expect(validateSafePuml(generateContainerDiagram(model)).valid).toBe(true);
    const remoteAttempt = validateSafePuml('@startuml\n!include https://evil.example/x.puml\n@enduml');
    expect(remoteAttempt.valid).toBe(false);
    expect(remoteAttempt.line).toBe(2);

    const localFileAttempt = validateSafePuml('@startuml\n!include /etc/passwd\n@enduml');
    expect(localFileAttempt.valid).toBe(false);

    const envAttempt = validateSafePuml('@startuml\ntitle %getenv("JWT_SECRET")\n@enduml');
    expect(envAttempt.valid).toBe(false);
  });
});
