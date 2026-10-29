type Passage = { title: string | null; canonicalUrl: string; text: string };
type Dependencies = {
  retrieve: (question: string) => Promise<Passage[]>;
  answer: (question: string, context: string) => Promise<string>;
};

/** HTTP boundary for evidence-grounded chat. */
export function chatHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let input: unknown;
    const effects: unknown[] = [];
    const respond = (body: unknown, status = 200) => {
      emitTestTrace({ handler: 'chatHandler', input, effects, response: { status, body } });
      return Response.json(body, { status });
    };
    try { input = await request.json(); }
    catch { return respond({ error: "Invalid JSON body." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return respond({ error: "Expected an object." }, 400);
    }
    const question = (input as Record<string, unknown>).question;
    if (typeof question !== "string" || !question.trim() || question.length > 4_000) {
      return respond({ error: "A question is required (maximum 4000 characters)." }, 400);
    }
    try {
      const retrievalInput = {question: question.trim()};
      const passages = await deps.retrieve(retrievalInput.question);
      effects.push({operation: 'retrieve', input: retrievalInput, output: {passageCount: passages.length, passages}});
      if (!passages.length) return respond({
        answer: "No indexed research matches this question yet. Add a source and run research first.",
        passages: [],
      });
      const context = passages.map((passage, index) =>
        `[${index + 1}] ${passage.title ?? passage.canonicalUrl}\n${passage.text}`,
      ).join("\n\n");
      const answer = await deps.answer(question.trim(), context);
      effects.push({operation: 'answer', input: {question: question.trim(), context}, output: answer});
      return respond({ answer, passages });
    } catch (error) {
      effects.push({operation: 'handler', threw: error instanceof Error ? error.message : String(error)});
      return respond({ error: "Evidence-grounded chat is temporarily unavailable." }, 503);
    }
  };
}
import { emitTestTrace } from './test-trace.ts';
