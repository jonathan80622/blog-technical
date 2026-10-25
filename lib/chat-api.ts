type Passage = { title: string | null; canonicalUrl: string; text: string };
type Dependencies = {
  retrieve: (question: string) => Promise<Passage[]>;
  answer: (question: string, context: string) => Promise<string>;
};

/** HTTP boundary for evidence-grounded chat. */
export function chatHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let input: unknown;
    try { input = await request.json(); }
    catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return Response.json({ error: "Expected an object." }, { status: 400 });
    }
    const question = (input as Record<string, unknown>).question;
    if (typeof question !== "string" || !question.trim() || question.length > 4_000) {
      return Response.json({ error: "A question is required (maximum 4000 characters)." }, { status: 400 });
    }
    try {
      const passages = await deps.retrieve(question.trim());
      if (!passages.length) return Response.json({
        answer: "No indexed research matches this question yet. Add a source and run research first.",
        passages: [],
      });
      const context = passages.map((passage, index) =>
        `[${index + 1}] ${passage.title ?? passage.canonicalUrl}\n${passage.text}`,
      ).join("\n\n");
      return Response.json({ answer: await deps.answer(question.trim(), context), passages });
    } catch {
      return Response.json({ error: "Evidence-grounded chat is temporarily unavailable." }, { status: 503 });
    }
  };
}
