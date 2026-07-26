/**
 * Canonicalize harmless formatting differences before retrieval and generation.
 * The original question is still retained for conversation history and auditing.
 */
export function normalizeKnowledgeQuestion(question: string): string {
  return question
    .normalize('NFC')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s+/gu, ' ')
    .replace(/([A-Za-z])\s*(\d)/g, '$1 $2')
    .replace(/(\d)\s*([A-Za-z])/g, '$1 $2')
    .trim();
}
