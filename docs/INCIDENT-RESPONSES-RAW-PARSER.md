# Incident report: raw Responses payload was parsed as an SDK object

**Incident ID:** `INC-RESP-2026-10-18-001`  
**Scope:** `discoverOfficialPortfolio()` and the identical output-parsing pattern used by the other OpenAI extraction helpers  
**Status:** parser and output contract corrected in the working tree; production still needs a deployed retry to prove the full path

## The exact belief that caused the bug

I used `fetch("https://api.openai.com/v1/responses")`, parsed the response with
`await response.json()`, and then treated that plain JSON object as if it were
the object returned by an OpenAI SDK helper:

```ts
// pre-fix lib/openai.ts
const json = await response.json() as { output_text?: string };
if (!json.output_text) {
  throw new Error("Official-site discovery returned no text.");
}
const value = JSON.parse(json.output_text);
```

The basis for that belief was incomplete reading of SDK-oriented examples such
as:

```ts
const response = await client.responses.create(...);
console.log(response.output_text);
```

I copied the property name but did **not** establish whether `output_text` was a
literal top-level field in the REST JSON returned by raw `fetch`, or a
convenience field constructed by the SDK. The code had no OpenAI SDK client at
all. It used raw HTTP.

That was not a justified conclusion from the evidence available. It was an
unverified implementation shortcut at a minute API-shape boundary. Calling it a
“brain fart” would hide the useful mechanism: I saw an SDK example, silently
substituted a different transport abstraction, and did not test the response
shape of that abstraction.

## The actual raw response shape

For a completed Responses web-search request, the assistant result is an item
inside the `output` array. Its text is in `content`:

```json
{
  "status": "completed",
  "output": [
    {
      "type": "web_search_call"
    },
    {
      "type": "message",
      "status": "completed",
      "content": [
        {
          "type": "output_text",
          "text": "{\"officialUrl\": \"https://...\"}"
        }
      ]
    }
  ]
}
```

`json.output_text` is therefore `undefined` for this raw payload even though
the response contains complete assistant text. The pre-fix guard converted that
successful provider result into the false local error “Official-site discovery
returned no text.”

OpenAI’s web-search guide shows the raw `message` / `content` / `output_text`
item structure, while its JavaScript SDK examples show the SDK’s
`response.output_text` convenience access. These are not interchangeable APIs.

## Why TypeScript failed to protect this code

This assertion was compile-time only:

```ts
const json = await response.json() as { output_text?: string };
```

It does not validate JSON and does not add `output_text` to an object. It merely
tells TypeScript to permit `json.output_text`. At runtime:

```ts
const raw = { output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] };
raw.output_text; // undefined
```

So `tsc --noEmit` passed precisely because the type assertion suppresses the
missing-field mismatch. `next build` passed because it bundles the code but
does not execute an authenticated web-search response.

## Propagation through the workflow

The false local error took this exact path:

1. `workflows/discover-investor.ts::findPortfolio(name)` called
   `discoverOfficialPortfolio(name)`.
2. The raw Responses payload was parsed into `json`.
3. `json.output_text` was `undefined` despite nested response text.
4. `discoverOfficialPortfolio()` threw `Official-site discovery returned no text.`
5. Vercel Workflow retried `findPortfolio` three times. A deterministic parser
   bug is not repaired by retrying the same request/parser pair.
6. The workflow catch block wrote `Job.state = FAILED` and the `progress` value
   visible in the UI: `Discovery failed: Step ... findPortfolio ...`.

This explains why five unrelated firms failed with the same step and same text:
the defect was downstream of the search result and upstream of investor-specific
URL validation.

## Corrected implementation

[`lib/openai.ts`](/Users/jonathan/Codeland/blog-technical/lib/openai.ts) now has
these two mechanisms:

```ts
function responseText(payload: ResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  return payload.output
    ?.flatMap(item => item.content ?? [])
    .filter(content => content.type === "output_text")
    .map(content => content.text ?? "")
    .join("")
    .trim() ?? "";
}
```

That accepts both a top-level convenience field, if a future provider response
does include one, and the documented raw `output[].content[].text` shape.

The discovery request also now supplies `text.format` with a strict JSON Schema:

```ts
text: {
  format: {
    type: "json_schema",
    name: "official_portfolio",
    strict: true,
    schema: officialPortfolioSchema
  }
}
```

The previous request only instructed the model in prose to “Return exactly one
JSON object.” That is not an output contract. A valid textual response could
still be markdown, incomplete JSON, or have omitted keys. The schema now
requires `officialUrl`, `portfolioUrl`, and `reason`, with no extra properties.

## Reproduce the original bug against a real Responses request

Use a disposable environment with an API key and make this raw request:

```sh
curl https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "tools": [{"type": "web_search"}],
    "tool_choice": "required",
    "input": "Find the official homepage and portfolio page for Thrive Capital. Return JSON."
  }'
```

Save the response as `response.json`. Inspect it with:

```sh
node -e '
const r = require("./response.json");
console.log("top-level output_text:", r.output_text);
console.log("nested text:", r.output?.flatMap(x => x.content ?? []).filter(x => x.type === "output_text").map(x => x.text));
'
```

With the response form that caused this incident, the first line is `undefined`
and the second line contains the assistant’s JSON. Running the pre-fix parser
against that same file reproduces the false error:

```sh
node -e '
const r = require("./response.json");
if (!r.output_text) throw new Error("Official-site discovery returned no text.");
'
```

No network, model behavior, or VC-specific source is required to reproduce the
core defect once a captured response fixture exists:

```sh
node -e '
const r = { output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] };
if (!r.output_text) console.log("reproduced: false no-text failure");
'
```

## What should have been verified before claiming implementation completion

1. Make one authenticated raw Responses request with the exact request body.
2. Persist or fixture the returned JSON with secrets removed.
3. Unit-test the parser against that fixture and a tool-only/incomplete fixture.
4. Assert that the parsed object has the required fields.
5. Run one deployed VC workflow through `findPortfolio`, not merely a build.

The correct completion label before those checks was **compiled, not proven**.

## Source basis

The raw web-search output structure and SDK example distinction are documented
in the official OpenAI [Web search guide](https://developers.openai.com/api/docs/guides/tools-web-search).
The `text.format` JSON Schema mechanism is documented in the official OpenAI
[Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
