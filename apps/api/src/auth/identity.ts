import { Injectable } from '@nestjs/common';

import { AppConfig } from '../config/app-config';

export interface Identity {
  tenantId: string;
  userId: string;
  department: string;
  sensitivity: 'public' | 'internal' | 'confidential';
}

@Injectable()
export class IdentityService {
  constructor(private readonly config: AppConfig) {}

  current(): Identity {
    if (this.config.values.AUTH_REQUIRED) {
      throw new Error('AUTH_REQUIRED=true requires the later OIDC implementation');
    }
    return {
      tenantId: this.config.values.DEV_TENANT_ID,
      userId: this.config.values.DEV_USER_ID,
      department: this.config.values.DEV_DEPARTMENT,
      sensitivity: this.config.values.DEV_SENSITIVITY,
    };
  }
}
