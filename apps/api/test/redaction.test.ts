import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { RedactionService } from '../src/ingestion/redaction';

describe('RedactionService', () => {
  it('redacts built-in PII and configured business identifiers without losing policy metadata', () => {
    const config = {
      values: {
        REDACTION_POLICY_VERSION: '2026-07-v1',
        BUSINESS_REDACTION_RULES_JSON: [{ name: 'CONTRACT', pattern: 'HT-[0-9]{6}', flags: 'u' }],
      },
    } as unknown as AppConfig;
    const service = new RedactionService(config);
    const result = service.redact(
      '邮箱 a.user@example.com，手机 13800138000，身份证 110101199001011234，' +
        '银行卡 6222 0200 0000 0000 000，合同 HT-123456。',
    );

    expect(result.text).not.toContain('a.user@example.com');
    expect(result.text).not.toContain('13800138000');
    expect(result.text).not.toContain('110101199001011234');
    expect(result.text).not.toContain('6222 0200 0000 0000 000');
    expect(result.text).not.toContain('HT-123456');
    expect(result.policyVersion).toBe('2026-07-v1');
    expect(result.summary).toMatchObject({
      EMAIL: 1,
      PHONE: 1,
      ID_CARD: 1,
      BANK_CARD: 1,
      BUSINESS_CONTRACT: 1,
    });
  });
});
