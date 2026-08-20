export const navigationTargets = [
  '/ask',
  '/history',
  '/documents',
  '/ingestion-jobs',
  '/audit',
  '/access/users',
  '/access/departments',
  '/settings/providers',
  '/system/usage',
  '/system/status',
] as const;

export type NavigationTarget = (typeof navigationTargets)[number];
