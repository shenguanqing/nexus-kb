import { z } from 'zod';

export const appRoleSchema = z.enum(['user', 'admin']);
export const appRolesSchema = z.array(appRoleSchema).length(1);

export type AppRole = z.infer<typeof appRoleSchema>;
