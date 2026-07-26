import { Inject, Injectable, Optional } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyResult } from 'jose';
import { z } from 'zod';

import { AppConfig } from '../config/app-config';
import { IDENTITY_ROLE_INPUTS, normalizeAppRoles } from './app-role';
import { CAPABILITIES, SENSITIVITIES } from './identity';
import type { Identity } from './identity';
import type { TokenVerifier } from './token-verifier';
import { TokenVerificationError } from './token-verifier';

export const JWT_VERIFY_FUNCTION = Symbol('JWT_VERIFY_FUNCTION');
export type JwtVerifyFunction = (token: string) => Promise<JWTVerifyResult<JWTPayload>>;

const identityClaimsSchema = z
  .object({
    sub: z.string().min(1).max(256),
    tenantId: z.string().min(1).max(128),
    department: z.string().min(1).max(128),
    roles: z.array(z.enum(IDENTITY_ROLE_INPUTS)).min(1).max(32),
    allowedSensitivities: z.array(z.enum(SENSITIVITIES)).min(1).max(3),
    capabilities: z.array(z.enum(CAPABILITIES)).max(16),
    defaultSensitivity: z.enum(SENSITIVITIES),
  })
  .passthrough()
  .refine(
    (claims) => claims.allowedSensitivities.includes(claims.defaultSensitivity),
    'defaultSensitivity must be allowed',
  );

@Injectable()
export class OidcJwtTokenVerifier implements TokenVerifier {
  private verifyFunction?: JwtVerifyFunction;

  constructor(
    private readonly config: AppConfig,
    @Optional()
    @Inject(JWT_VERIFY_FUNCTION)
    verifyFunction?: JwtVerifyFunction,
  ) {
    this.verifyFunction = verifyFunction;
  }

  async verify(token: string): Promise<Identity> {
    try {
      const result = await this.jwtVerifier()(token);
      const claims = identityClaimsSchema.parse(result.payload);
      return {
        tenantId: claims.tenantId,
        userId: claims.sub,
        department: claims.department,
        roles: normalizeAppRoles(claims.roles),
        allowedSensitivities: [...new Set(claims.allowedSensitivities)],
        capabilities: [...new Set(claims.capabilities)],
        defaultSensitivity: claims.defaultSensitivity,
      };
    } catch (error) {
      if (error instanceof TokenVerificationError) throw error;
      throw new TokenVerificationError({ cause: error });
    }
  }

  private jwtVerifier(): JwtVerifyFunction {
    if (this.verifyFunction) return this.verifyFunction;
    const environment = this.config.values;
    const remoteJwks = createRemoteJWKSet(new URL(environment.OIDC_JWKS_URI), {
      timeoutDuration: environment.OIDC_JWKS_TIMEOUT_MS,
    });
    this.verifyFunction = (token) =>
      jwtVerify(token, remoteJwks, {
        issuer: environment.OIDC_ISSUER,
        audience: environment.OIDC_AUDIENCE,
        algorithms: environment.OIDC_ALLOWED_ALGORITHMS_JSON,
        clockTolerance: environment.OIDC_CLOCK_TOLERANCE_SECONDS,
      });
    return this.verifyFunction;
  }
}
