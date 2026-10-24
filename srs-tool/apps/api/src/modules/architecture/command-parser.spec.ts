import { describe, it, expect } from 'vitest';
import { CommandParser } from './command-parser';

describe('CommandParser', () => {
  it('parses rename element command in English', () => {
    const result = CommandParser.parse('rename element api_server to BackendAPI');
    expect(result.matched).toBe(true);
    expect(result.commandType).toBe('rename');
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toEqual({
      op: 'update_element',
      element_id: 'api_server',
      changes: { name: 'BackendAPI' },
    });
  });

  it('parses rename element command in Vietnamese', () => {
    const result = CommandParser.parse('đổi tên thành phần database thành CSDL_Chính');
    expect(result.matched).toBe(true);
    expect(result.operations[0]).toEqual({
      op: 'update_element',
      element_id: 'database',
      changes: { name: 'CSDL_Chính' },
    });
  });

  it('parses add element command', () => {
    const result = CommandParser.parse('add element container AuthGateway tech "Node.js" platform web');
    expect(result.matched).toBe(true);
    expect(result.commandType).toBe('add_element');
    expect(result.operations[0]).toMatchObject({
      op: 'add_element',
      element: {
        id: 'authgateway',
        kind: 'container',
        name: 'AuthGateway',
        technology: 'Node.js',
        platform: 'web',
      },
    });
  });

  it('parses connect command with label and protocol', () => {
    const result = CommandParser.parse('connect web_app to api_server label "gửi yêu cầu" protocol HTTPS');
    expect(result.matched).toBe(true);
    expect(result.commandType).toBe('connect');
    expect(result.operations[0]).toMatchObject({
      op: 'add_relationship',
      relationship: {
        source_id: 'web_app',
        target_id: 'api_server',
        label: 'gửi yêu cầu',
        protocol: 'HTTPS',
      },
    });
  });

  it('parses remove element command', () => {
    const result = CommandParser.parse('remove element legacy_service');
    expect(result.matched).toBe(true);
    expect(result.commandType).toBe('remove_element');
    expect(result.operations[0]).toEqual({
      op: 'remove_element',
      element_id: 'legacy_service',
    });
  });

  it('parses change tech command', () => {
    const result = CommandParser.parse('change tech of cache to "Redis 7.2"');
    expect(result.matched).toBe(true);
    expect(result.commandType).toBe('change_tech');
    expect(result.operations[0]).toEqual({
      op: 'update_element',
      element_id: 'cache',
      changes: { technology: 'Redis 7.2' },
    });
  });

  it('returns matched=false for free-form instructions', () => {
    const result = CommandParser.parse('hãy tối ưu hóa kiến trúc và thêm hệ thống cảnh báo');
    expect(result.matched).toBe(false);
    expect(result.operations).toHaveLength(0);
  });
});
