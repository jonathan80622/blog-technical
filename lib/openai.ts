const key = process.env.OPENAI_API_KEY;
function headers() { if (!key) throw new Error("OPENAI_API_KEY is not configured."); return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }; }
export async function embed(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", { method:"POST", headers:headers(), body:JSON.stringify({ model:process.env.EMBEDDING_MODEL ?? "text-embedding-3-small", input:text }) });
  if (!response.ok) throw new Error(`Embedding request failed: ${await response.text()}`);
  const json = await response.json() as { data: Array<{ embedding:number[] }> };
  return json.data[0].embedding;
}
export async function answer(question:string, context:string) {
  const response = await fetch("https://api.openai.com/v1/responses", { method:"POST", headers:headers(), body:JSON.stringify({ model:process.env.OPENAI_CHAT_MODEL ?? "gpt-5-mini", instructions:"Answer only from the supplied research passages. State uncertainty when the passages do not establish an answer. Do not turn missing evidence into a negative claim. Cite passages as [1], [2], etc.", input:`Research passages:\n${context}\n\nQuestion: ${question}` }) });
  if (!response.ok) throw new Error(`Chat request failed: ${await response.text()}`);
  const json = await response.json() as { output_text?:string };
  return json.output_text ?? "The model returned no text.";
}
