import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { spawn } from "node:child_process";

const port = Number(process.env.TEST_OBSERVER_PORT ?? 4319);
const events = [];
const clients = new Set();
let running = false;
const html = `<!doctype html><title>Runtime test evidence</title><style>
body{margin:0;background:#10151c;color:#e7edf3;font:14px ui-monospace,Menlo,monospace}header{padding:20px 28px;background:#18212c;position:sticky;top:0;z-index:2}h1{margin:0;font-size:18px}.sub{color:#9db0c4;margin-top:8px}button{margin-top:12px;background:#8de2b2;color:#10151c;border:0;border-radius:5px;padding:9px 12px;font:700 13px ui-monospace,Menlo,monospace;cursor:pointer}button:disabled{opacity:.5}main{display:grid;grid-template-columns:minmax(420px,1fr) minmax(520px,1fr);min-height:calc(100vh - 96px)}#events,#source{padding:12px 28px}.event{padding:12px;border-bottom:1px solid #263342}.event[data-file]{cursor:pointer}.event[data-file]:hover{background:#18212c}.pass{border-left:3px solid #8de2b2}.fail{border-left:3px solid #ff9b9b}.registered{border-left:3px solid #52677d}.start{border-left:3px solid #8ab8ff}.file{color:#c7d6e6;font-weight:700}.name{margin:6px 0;white-space:pre-wrap}.time,.muted{color:#8092a5;font-size:12px}#source{border-left:1px solid #263342;overflow:auto}.evidence{margin-top:10px;padding:10px;background:#151d27;border:1px solid #2d3b4c;border-radius:4px;cursor:default}.evidence summary{color:#8de2b2;font-weight:700}.label{display:block;color:#9db0c4;font-size:12px;margin-top:10px}pre{color:#d8e6f4;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.none{color:#ffcc7b;margin-top:8px;font-size:12px}
</style><header><h1>Runtime test evidence</h1><div class=sub id=status>Ready. Run tests to capture values that actually entered and left instrumented handlers.</div><button id=run>Run all discovered tests</button></header><main><section id=events></section><aside id=source>Select a test. Its runtime input, output, and effects appear on the left after it runs; its executable source appears here.</aside></main><script>
const list=document.querySelector('#events'),status=document.querySelector('#status'),source=document.querySelector('#source'),run=document.querySelector('#run'),cards=new Map;
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;');const pretty=v=>esc(JSON.stringify(v,null,2));const key=e=>(e.file||'')+'\\0'+(e.name||'');
run.onclick=async()=>{run.disabled=true;status.textContent='Starting real test run…';const r=await fetch('/run',{method:'POST'});if(!r.ok){status.textContent='Could not start test run.';run.disabled=false}};
async function show(e){if(!e.file||!e.name)return;const r=await fetch('/source?file='+encodeURIComponent(e.file)+'&name='+encodeURIComponent(e.name));if(!r.ok)return;const x=await r.json();source.innerHTML='<b>'+esc(x.file)+':'+x.startLine+'</b><p>'+esc(x.summary)+'</p><pre>'+esc(x.source)+'</pre>'}
function evidenceHtml(e){if((e.type!=='pass'&&e.type!=='fail')||!e.file)return '';if(!e.evidence?.length)return '<div class=none>This test has no captured runtime boundary evidence yet. PASS only means its assertions succeeded.</div>';return e.evidence.map(x=>'<details class=evidence open><summary>'+esc(x.handler||'runtime event')+' · HTTP '+esc(x.response?.status??'—')+'</summary><span class=label>ACTUAL INPUT</span><pre>'+pretty(x.input)+'</pre><span class=label>ACTUAL EFFECTS</span><pre>'+pretty(x.effects||[])+'</pre><span class=label>ACTUAL OUTPUT</span><pre>'+pretty(x.response?.body)+'</pre></details>').join('')}
function render(e){if(e.type==='run-finished'){run.disabled=false;status.textContent=e.name;return}const k=key(e);let card=cards.get(k);if(e.type==='registered'){if(card)return;card=document.createElement('article');cards.set(k,card);list.append(card)}else if(!card){card=document.createElement('article');cards.set(k,card);list.prepend(card)}card.className='event '+e.type;if(e.file&&e.name){card.dataset.file=e.file;card.onclick=()=>show(e)}card.innerHTML='<div class=time>'+new Date(e.at).toLocaleTimeString()+'</div><div class=file>'+e.type.toUpperCase()+(e.file?' · '+esc(e.file):'')+'</div><div class=name>'+esc(e.name||e.message)+'</div>'+evidenceHtml(e)}
fetch('/events').then(r=>r.json()).then(es=>es.forEach(render));const stream=new EventSource('/stream');stream.onmessage=e=>render(JSON.parse(e.data));stream.onerror=()=>status.textContent='Reconnecting…';
</script>`;

function publish(event) { const item = { at: new Date().toISOString(), ...event }; events.push(item); if (events.length > 2_000) events.shift(); for (const client of clients) client.write(`data: ${JSON.stringify(item)}\n\n`); }
function sourceSlice(lines, name) { const index = Math.max(0, lines.findIndex(line => line.includes(name))); const start = Math.max(0, index - 12); return { startLine: start + 1, source: lines.slice(start, index + 24).join("\n") }; }

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") return response.end("runtime-evidence-v2");
  if (request.method === "GET" && url.pathname === "/") { response.setHeader("content-type", "text/html; charset=utf-8"); return response.end(html); }
  if (request.method === "GET" && url.pathname === "/events") { response.setHeader("content-type", "application/json"); return response.end(JSON.stringify(events)); }
  if (request.method === "GET" && url.pathname === "/stream") { response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); clients.add(response); request.on("close", () => clients.delete(response)); return; }
  if (request.method === "POST" && url.pathname === "/clear") { events.length = 0; return response.writeHead(204).end(); }
  if (request.method === "POST" && url.pathname === "/run") {
    if (running) return response.writeHead(409).end();
    running = true; publish({ type: "start", name: "Starting all discovered tests" });
    const child = spawn(process.execPath, ["scripts/run-test-audit.mjs", "--all"], { cwd: process.cwd(), env: { ...process.env, TEST_OBSERVER_URL: `http://127.0.0.1:${port}`, TEST_OBSERVER_NO_OPEN: "1" }, stdio: "ignore" });
    child.on("close", code => { running = false; publish({ type: "run-finished", name: code === 0 ? "All discovered tests passed." : "Test run failed." }); });
    return response.writeHead(202).end();
  }
  if (request.method === "POST" && url.pathname === "/events") { let body = ""; request.on("data", chunk => { body += chunk; }); request.on("end", () => { try { publish(JSON.parse(body)); response.writeHead(204).end(); } catch { response.writeHead(400).end(); } }); return; }
  if (request.method === "GET" && url.pathname === "/source") {
    const file = url.searchParams.get("file") ?? ""; const name = url.searchParams.get("name") ?? ""; const allowed = resolve(process.cwd(), "tests"); const absolute = resolve(process.cwd(), file);
    if (relative(allowed, absolute).startsWith("..")) return response.writeHead(403).end();
    try { const slice = sourceSlice((await readFile(absolute, "utf8")).split("\n"), name); response.setHeader("content-type", "application/json"); return response.end(JSON.stringify({ file, ...slice, summary: "This is the executable test source. Runtime values, when emitted by the handler, are shown in the test row." })); } catch { return response.writeHead(404).end(); }
  }
  response.writeHead(404).end();
});
server.on("error", error => { console.error(`Test observer could not listen on http://127.0.0.1:${port}: ${error.message}`); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Test observer listening at http://127.0.0.1:${port}`));
