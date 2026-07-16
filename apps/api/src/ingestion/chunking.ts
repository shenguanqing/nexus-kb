import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ParsedElement } from '@nexus-kb/contracts';

import { AppConfig } from '../config/app-config';

interface TokenSpan {
  start: number;
  end: number;
}

interface ElementPiece {
  text: string;
  tokenCount: number;
  elementIndex: number;
  partIndex: number;
  elementType: string;
  page: number | null;
  sheet: string | null;
  sectionPath: string[];
  scopeKey: string;
}

export interface ChunkDraft {
  id: string;
  ordinal: number;
  originalText: string;
  tokenCount: number;
  page: number | null;
  sheet: string | null;
  sectionPath: string[];
  elementTypes: string[];
  previousChunkId: string | null;
  nextChunkId: string | null;
}

@Injectable()
export class ChunkingService {
  constructor(private readonly config: AppConfig) {}

  createChunks(
    documentId: string,
    documentVersion: number,
    elements: ParsedElement[],
  ): ChunkDraft[] {
    const pieces = elements.flatMap((element, elementIndex) =>
      this.createElementPieces(element, elementIndex),
    );
    const chunks: ChunkDraft[] = [];
    let pending: ElementPiece[] = [];

    const flush = (): void => {
      if (pending.length === 0) return;
      const originalText = normalizeChunkText(pending.map((piece) => piece.text).join('\n\n'));
      const first = pending[0];
      const last = pending[pending.length - 1];
      if (!first || !last || !originalText) {
        pending = [];
        return;
      }
      const ordinal = chunks.length;
      const elementPath = [
        first.elementIndex,
        first.partIndex,
        last.elementIndex,
        last.partIndex,
        first.scopeKey,
      ].join(':');
      const id = createHash('sha256')
        .update(`${documentId}\0${documentVersion}\0${elementPath}\0${originalText}`)
        .digest('hex');
      chunks.push({
        id,
        ordinal,
        originalText,
        tokenCount: countTokens(originalText),
        page: first.page,
        sheet: first.sheet,
        sectionPath: first.sectionPath,
        elementTypes: [...new Set(pending.map((piece) => piece.elementType))],
        previousChunkId: null,
        nextChunkId: null,
      });
      pending = [];
    };

    for (const piece of pieces) {
      const pendingTokens = pending.reduce((total, current) => total + current.tokenCount, 0);
      const isSameScope = pending.length === 0 || pending[0]?.scopeKey === piece.scopeKey;
      if (
        pending.length > 0 &&
        (!isSameScope || pendingTokens + piece.tokenCount > this.config.values.CHUNK_MAX_TOKENS)
      ) {
        flush();
      }
      pending.push(piece);
    }
    flush();

    return chunks.map((chunk, index) => ({
      ...chunk,
      previousChunkId: chunks[index - 1]?.id ?? null,
      nextChunkId: chunks[index + 1]?.id ?? null,
    }));
  }

  private createElementPieces(element: ParsedElement, elementIndex: number): ElementPiece[] {
    const tableHeader = getTableHeader(element);
    if (tableHeader) return this.createTableRowPieces(element, elementIndex, tableHeader);
    const text = renderElement(element);
    const spans = tokenSpans(text);
    if (spans.length === 0) return [];
    const scopeKey = JSON.stringify([element.page, element.sheet, element.sectionPath]);
    const maxTokens = this.config.values.CHUNK_MAX_TOKENS;
    const overlapTokens = this.config.values.CHUNK_OVERLAP_TOKENS;
    const step = maxTokens - overlapTokens;
    const pieces: ElementPiece[] = [];

    for (
      let tokenStart = 0, partIndex = 0;
      tokenStart < spans.length;
      tokenStart += step, partIndex++
    ) {
      const tokenEnd = Math.min(tokenStart + maxTokens, spans.length);
      const startOffset = spans[tokenStart]?.start ?? 0;
      const endOffset = spans[tokenEnd - 1]?.end ?? text.length;
      const pieceText = normalizeChunkText(text.slice(startOffset, endOffset));
      if (pieceText) {
        pieces.push({
          text: pieceText,
          tokenCount: tokenEnd - tokenStart,
          elementIndex,
          partIndex,
          elementType: element.elementType,
          page: element.page,
          sheet: element.sheet,
          sectionPath: element.sectionPath,
          scopeKey,
        });
      }
      if (tokenEnd === spans.length) break;
    }
    return pieces;
  }

  private createTableRowPieces(
    element: ParsedElement,
    elementIndex: number,
    tableHeader: string,
  ): ElementPiece[] {
    const rowText = normalizeChunkText(element.text);
    const headerPrefix = `表头：${tableHeader}\n数据：`;
    const headerTokens = countTokens(headerPrefix);
    const availableTokens = this.config.values.CHUNK_MAX_TOKENS - headerTokens;
    if (availableTokens < 1) return this.createPlainPieces(element, elementIndex, rowText);
    const spans = tokenSpans(rowText);
    const overlapTokens = Math.min(
      this.config.values.CHUNK_OVERLAP_TOKENS,
      Math.max(0, availableTokens - 1),
    );
    const step = availableTokens - overlapTokens;
    const scopeKey = JSON.stringify([element.page, element.sheet, element.sectionPath]);
    const pieces: ElementPiece[] = [];

    for (
      let tokenStart = 0, partIndex = 0;
      tokenStart < spans.length;
      tokenStart += step, partIndex++
    ) {
      const tokenEnd = Math.min(tokenStart + availableTokens, spans.length);
      const startOffset = spans[tokenStart]?.start ?? 0;
      const endOffset = spans[tokenEnd - 1]?.end ?? rowText.length;
      const text = normalizeChunkText(`${headerPrefix}${rowText.slice(startOffset, endOffset)}`);
      pieces.push({
        text,
        tokenCount: countTokens(text),
        elementIndex,
        partIndex,
        elementType: element.elementType,
        page: element.page,
        sheet: element.sheet,
        sectionPath: element.sectionPath,
        scopeKey,
      });
      if (tokenEnd === spans.length) break;
    }
    return pieces;
  }

  private createPlainPieces(
    element: ParsedElement,
    elementIndex: number,
    text: string,
  ): ElementPiece[] {
    const plainElement = { ...element, text, metadata: {} };
    return this.createElementPieces(plainElement, elementIndex);
  }
}

export function countTokens(text: string): number {
  return tokenSpans(text).length;
}

function tokenSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const tokenPattern =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+|[^\s]/gu;
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function renderElement(element: ParsedElement): string {
  return normalizeChunkText(element.text);
}

function getTableHeader(element: ParsedElement): string | null {
  if (element.elementType !== 'table_row') return null;
  const headers = element.metadata.headers;
  if (!Array.isArray(headers)) return null;
  const normalizedHeaders = headers.filter(
    (header): header is string => typeof header === 'string' && header.trim().length > 0,
  );
  return normalizedHeaders.length > 0 ? normalizedHeaders.join(' | ') : null;
}

function normalizeChunkText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
