import { Injectable } from '@nestjs/common';

import { AppConfig } from '../config/app-config';

type RedactionKind = 'PHONE' | 'ID_CARD' | 'BANK_CARD' | 'EMAIL' | `BUSINESS_${string}`;

export interface RedactionResult {
  text: string;
  policyVersion: string;
  summary: Record<string, number>;
}

interface CompiledRule {
  kind: RedactionKind;
  expression: RegExp;
}

const BUILT_IN_RULES: CompiledRule[] = [
  {
    kind: 'EMAIL',
    expression: /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w.-])/giu,
  },
  {
    kind: 'PHONE',
    expression: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/gu,
  },
  {
    kind: 'ID_CARD',
    expression: /(?<![0-9A-Z])(?:\d{15}|\d{17}[0-9X])(?![0-9A-Z])/giu,
  },
  {
    kind: 'BANK_CARD',
    expression: /(?<!\d)(?:\d[ -]?){11,18}\d(?!\d)/gu,
  },
];

@Injectable()
export class RedactionService {
  private readonly rules: CompiledRule[];

  constructor(private readonly config: AppConfig) {
    this.rules = [
      ...BUILT_IN_RULES,
      ...config.values.BUSINESS_REDACTION_RULES_JSON.map((rule) => ({
        kind: `BUSINESS_${rule.name}` as const,
        expression: new RegExp(rule.pattern, ensureGlobalFlag(rule.flags)),
      })),
    ];
  }

  redact(text: string): RedactionResult {
    let redactedText = text;
    const summary: Record<string, number> = {};
    for (const rule of this.rules) {
      let count = 0;
      redactedText = redactedText.replace(rule.expression, () => {
        count++;
        return `[REDACTED:${rule.kind}]`;
      });
      if (count > 0) summary[rule.kind] = count;
    }
    return {
      text: redactedText,
      policyVersion: this.config.values.REDACTION_POLICY_VERSION,
      summary,
    };
  }
}

function ensureGlobalFlag(flags: string): string {
  return flags.includes('g') ? flags : `${flags}g`;
}
