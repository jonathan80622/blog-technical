import test from "node:test";
import assert from "node:assert/strict";
import { chatHandler } from "../lib/chat-api.ts";

const request = (body: string) => new Request("http://localhost/api/chat", { method: "POST", body });

test("Given invalid chat input, Then return validation errors without retrieval or provider calls", async () => {
  let calls = 0;
  const handler = chatHandler({ retrieve: async () => { calls++; return []; }, answer: async () => { calls++; return "answer"; } });
  for (const body of ["{", "null", "[]", "{}", JSON.stringify({ question: " " }), JSON.stringify({ question: "x".repeat(4_001) })]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal(calls, 0);
});

test("Given no indexed passages, Then return the explicit empty-retrieval result without calling the model", async () => {
  let answered = false;
  const handler = chatHandler({ retrieve: async question => { assert.equal(question, "What is the trend?"); return []; }, answer: async () => { answered = true; return "unexpected"; } });
  const response = await handler(request(JSON.stringify({ question: "  What is the trend?  " })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    answer: "No indexed research matches this question yet. Add a source and run research first.",
    passages: [],
  });
  assert.equal(answered, false);
});

test("Given indexed passages, Then the answer receives only the retrieved evidence context", async () => {
  let receivedQuestion = "";
  let receivedContext = "";
  const handler = chatHandler({
    retrieve: async () => [{ title: "AI Hiring", canonicalUrl: "https://acme.example/jobs", text: "Hiring ML engineers." }],
    answer: async (question, context) => { receivedQuestion = question; receivedContext = context; return "Evidence-backed answer."; },
  });
  const response = await handler(request(JSON.stringify({ question: "  What is Acme hiring for?  " })));
  assert.equal(response.status, 200);
  assert.equal(receivedQuestion, "What is Acme hiring for?");
  assert.equal(receivedContext, "[1] AI Hiring\nHiring ML engineers.");
  assert.equal((await response.json()).answer, "Evidence-backed answer.");
});

test("Given a retrieval or provider failure, Then return a safe service error", async () => {
  const handler = chatHandler({ retrieve: async () => { throw new Error("database password"); }, answer: async () => "" });
  const response = await handler(request(JSON.stringify({ question: "question" })));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Evidence-grounded chat is temporarily unavailable." });
});
