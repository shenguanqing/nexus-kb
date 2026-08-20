import { describe, expect, it } from 'vitest';
import { router } from './index';

describe('route navigation ownership', () => {
  it.each([
    ['/ask', '/ask'],
    ['/history', '/history'],
    ['/documents', '/documents'],
    ['/documents/6769af9a-a4d0-4dc2-a97d-942584a9c826', '/documents'],
    ['/documents/6769af9a-a4d0-4dc2-a97d-942584a9c826/preview', '/documents'],
    ['/documents/6769af9a-a4d0-4dc2-a97d-942584a9c826/chunks', '/documents'],
    ['/ingestion-jobs', '/ingestion-jobs'],
    ['/audit', '/audit'],
    ['/access/users', '/access/users'],
    ['/access/departments', '/access/departments'],
    ['/settings/providers', '/settings/providers'],
    ['/system/usage', '/system/usage'],
    ['/system/status', '/system/status'],
  ])('maps %s to %s', (path, activeNavigation) => {
    expect(router.resolve(path).meta.activeNavigation).toBe(activeNavigation);
  });
});
