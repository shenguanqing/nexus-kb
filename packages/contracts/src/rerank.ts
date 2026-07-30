import { z } from 'zod';

export const localRerankRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(4_000),
    documents: z.array(z.string().trim().min(1).max(120_000)).min(1).max(100),
    topK: z.number().int().min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.topK > value.documents.length) {
      context.addIssue({
        code: 'custom',
        path: ['topK'],
        message: 'must not exceed the number of documents',
      });
    }
  });

export const localRerankResponseSchema = z
  .object({
    model: z.string().min(1).max(128),
    results: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          relevanceScore: z.number().finite(),
        })
        .strict(),
    ),
  })
  .strict();

export type LocalRerankRequest = z.infer<typeof localRerankRequestSchema>;
export type LocalRerankResponse = z.infer<typeof localRerankResponseSchema>;
