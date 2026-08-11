const CONTEXT_REFERENCE_PATTERN =
  /(?:它|它们|他|他们|她|她们|其|该(?:项|条|个|方案|文档|版本|模型|功能|问题)?|这(?:个|些|项|条|两者|一|二)?|那(?:个|些|项|条)?|上述|前者|后者|上一个|上一条|刚才|之前|继续|分别|二者|两者|还有呢|怎么样呢|\b(?:it|its|they|them|their|this|that|these|those|former|latter|above|previous)\b)/iu;

const MAX_CONVERSATION_CONTEXT_TURNS = 4;
const MAX_CONVERSATION_CONTEXT_CHARACTERS = 4_000;

export function selectConversationQuestions(questions: string[]): string[] {
  const selected: string[] = [];
  let characters = 0;
  for (const question of questions.slice(-MAX_CONVERSATION_CONTEXT_TURNS).reverse()) {
    const remaining = MAX_CONVERSATION_CONTEXT_CHARACTERS - characters;
    if (remaining <= 0) break;
    const normalized = question.trim().slice(-remaining);
    if (!normalized) continue;
    selected.push(normalized);
    characters += normalized.length;
  }
  return selected.reverse();
}

export function needsConversationContext(question: string): boolean {
  return CONTEXT_REFERENCE_PATTERN.test(question);
}

export function buildRetrievalQuestion(question: string, conversationQuestions: string[]): string {
  if (conversationQuestions.length === 0 || !needsConversationContext(question)) {
    return question;
  }
  const history = conversationQuestions
    .map((previousQuestion, index) => `${index + 1}. ${previousQuestion}`)
    .join('\n');
  return `对话中的前序问题：\n${history}\n\n当前问题：${question}`;
}
