const CONTEXT_REFERENCE_PATTERN =
  /(?:它|它们|他|他们|她|她们|其|该(?:项|条|个|方案|文档|版本|模型|功能|问题)?|这(?:个|些|项|条|两者|一|二)?|那(?:个|些|项|条)?|上述|前者|后者|上一个|上一条|刚才|之前|继续|分别|二者|两者|还有呢|怎么样呢|\b(?:it|its|they|them|their|this|that|these|those|former|latter|above|previous)\b)/iu;

const IMPLICIT_FOLLOW_UP_PATTERN =
  /^(?:(?:请|再|帮我|麻烦)?(?:列(?:个|出|一下)?|整理(?:一下|成)?|汇总(?:一下|成)?|做成|改成|生成(?:一个|一份)?|转成|总结(?:一下)?|详细(?:说说|说明)?|展开(?:说说|说明)?|用表格(?:列出|展示)?|给(?:个|出)?)(?:所需|需要|相关|对应|以上|这些|上述|前面|前述|其中|具体|详细|完整|全部|一下|成|为|的|申请|办理|\s)*(?:材料|条件|步骤|流程|内容|信息|要点|清单|列表|表格|示例|区别|优缺点|要求|依据)(?:清单|列表|表格|说明)?|(?:需要|要|有哪些|包括哪些|具体有哪些|是什么|怎么做)(?:的|哪些|什么|\s)*(?:材料|条件|步骤|流程|内容|信息|要点|要求|依据))(?:[。？！?])?$/u;

const IMPLICIT_OBJECT_FIRST_FOLLOW_UP_PATTERN =
  /^(?:请|再|帮我|麻烦)?(?:所需|需要的?|申请|办理|相关|这些|上述|前面|前述|具体|全部|完整|\s)*(?:材料|条件|步骤|流程|内容|信息|要点|清单|列表|表格|示例|区别|优缺点|要求|依据)(?:列(?:个|出|一下)?|整理(?:一下|成)?|汇总(?:一下|成)?|做成|改成|生成(?:一个|一份)?|转成|总结(?:一下)?|详细(?:说说|说明)?|展开(?:说说|说明)?|用表格(?:列出|展示)?)(?:清单|列表|表格|说明)?(?:[。？！?])?$/u;

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
  const normalized = question.trim();
  return (
    CONTEXT_REFERENCE_PATTERN.test(normalized) ||
    IMPLICIT_FOLLOW_UP_PATTERN.test(normalized) ||
    IMPLICIT_OBJECT_FIRST_FOLLOW_UP_PATTERN.test(normalized)
  );
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
