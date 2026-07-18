import { z } from 'zod';

export const qualityCaseKindSchema = z.enum(['answerable', 'no_answer', 'unauthorized']);
export const qualityVariantSchema = z.enum(['vector_top_5', 'vector_top_20_rerank_top_5']);

export const qualitySourceSchema = z
  .object({
    documentId: z.uuid(),
    page: z.number().int().positive().nullable(),
    sheet: z.string().min(1).max(255).nullable(),
    chunkIds: z
      .array(z.string().regex(/^[0-9a-f]{64}$/))
      .max(100)
      .default([]),
  })
  .strict();

export const qualityDecisionPolicySchema = z
  .object({
    minFinalRecallAt5: z.number().min(0).max(1),
    minMrr: z.number().min(0).max(1),
    minCitationAccuracy: z.number().min(0).max(1),
    minNoAnswerRejectionRate: z.number().min(0).max(1),
    maxErrorRate: z.number().min(0).max(1),
    minRecallGain: z.number().min(0).max(1),
    minMrrGain: z.number().min(0).max(1),
    maxCitationAccuracyRegression: z.number().min(0).max(1),
    maxNoAnswerRejectionRegression: z.number().min(0).max(1),
    maxP95LatencyRatio: z.number().min(1).max(10),
    maxAverageCostRatio: z.number().min(1).max(10),
  })
  .strict();

export const qualityEvaluationCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
    kind: qualityCaseKindSchema,
    identityProfile: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
    question: z
      .string()
      .trim()
      .min(2)
      .max(2000)
      .transform((value) => value.normalize('NFC')),
    expectedAnswer: z.string().trim().min(1).max(10_000).nullable(),
    expectedSources: z.array(qualitySourceSchema).max(20),
    tags: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/))
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'no_answer') {
      if (value.expectedAnswer !== null) {
        context.addIssue({
          code: 'custom',
          path: ['expectedAnswer'],
          message: 'must be null for no_answer cases',
        });
      }
      if (value.expectedSources.length !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['expectedSources'],
          message: 'must be empty for no_answer cases',
        });
      }
      return;
    }
    if (value.expectedAnswer === null) {
      context.addIssue({
        code: 'custom',
        path: ['expectedAnswer'],
        message: 'is required for answerable and unauthorized cases',
      });
    }
    if (value.expectedSources.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['expectedSources'],
        message: 'must contain at least one target source',
      });
    }
  });

export const qualityEvaluationDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,127}$/),
    name: z.string().trim().min(1).max(255),
    createdAt: z.iso.datetime({ offset: true }),
    decisionPolicy: qualityDecisionPolicySchema,
    cases: z.array(qualityEvaluationCaseSchema).min(30).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.cases.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['cases'], message: 'case IDs must be unique' });
    }
    for (const kind of qualityCaseKindSchema.options) {
      if (!value.cases.some((item) => item.kind === kind)) {
        context.addIssue({
          code: 'custom',
          path: ['cases'],
          message: `must contain at least one ${kind} case`,
        });
      }
    }
  });

export const qualityObservationSchema = z
  .object({
    caseId: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
    traceId: z.uuid(),
    noAnswer: z.boolean(),
    vectorSources: z.array(qualitySourceSchema).max(20),
    finalSources: z.array(qualitySourceSchema).max(5),
    citationSources: z.array(qualitySourceSchema).max(20),
    durationMs: z.number().int().nonnegative().max(3_600_000),
    costUsd: z.number().nonnegative().max(1_000_000).nullable(),
    errorCode: z.string().min(1).max(128).nullable(),
  })
  .strict();

export const qualityEvaluationRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,127}$/),
    variant: qualityVariantSchema,
    createdAt: z.iso.datetime({ offset: true }),
    configuration: z
      .object({
        recallTopK: z.union([z.literal(5), z.literal(20)]),
        rerankEnabled: z.boolean(),
        rerankTopK: z.literal(5).nullable(),
        embeddingProvider: z.string().min(1).max(64),
        embeddingModel: z.string().min(1).max(128),
        embeddingFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        collectionName: z.string().min(1).max(255),
        rerankProvider: z.string().min(1).max(64).nullable(),
        rerankModel: z.string().min(1).max(128).nullable(),
      })
      .strict(),
    observations: z.array(qualityObservationSchema).min(30).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.observations.map((item) => item.caseId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'case IDs must be unique',
      });
    }
    const isBaseline = value.variant === 'vector_top_5';
    const configurationMatches = isBaseline
      ? value.configuration.recallTopK === 5 &&
        !value.configuration.rerankEnabled &&
        value.configuration.rerankTopK === null &&
        value.configuration.rerankProvider === null &&
        value.configuration.rerankModel === null
      : value.configuration.recallTopK === 20 &&
        value.configuration.rerankEnabled &&
        value.configuration.rerankTopK === 5 &&
        value.configuration.rerankProvider !== null &&
        value.configuration.rerankModel !== null;
    if (!configurationMatches) {
      context.addIssue({
        code: 'custom',
        path: ['configuration'],
        message: 'does not match the selected evaluation variant',
      });
    }
  });

export type QualityCaseKind = z.infer<typeof qualityCaseKindSchema>;
export type QualityVariant = z.infer<typeof qualityVariantSchema>;
export type QualitySource = z.infer<typeof qualitySourceSchema>;
export type QualityDecisionPolicy = z.infer<typeof qualityDecisionPolicySchema>;
export type QualityEvaluationCase = z.infer<typeof qualityEvaluationCaseSchema>;
export type QualityEvaluationDataset = z.infer<typeof qualityEvaluationDatasetSchema>;
export type QualityObservation = z.infer<typeof qualityObservationSchema>;
export type QualityEvaluationRun = z.infer<typeof qualityEvaluationRunSchema>;
