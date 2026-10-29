import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { spawn } from "node:child_process";
import { discoverTestFiles } from "./test-discovery.mjs";

const root = process.cwd();
const observerUrl = process.env.TEST_OBSERVER_URL ?? `http://127.0.0.1:${process.env.TEST_OBSERVER_PORT ?? 4319}`;

async function request(path, body) {
  try { await fetch(`${observerUrl}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined); } catch { /* The test result must never depend on the viewer. */ }
}

async function ensureObserver() {
  try { const response = await fetch(`${observerUrl}/health`); if (response.ok) return true; } catch { /* start it below */ }
  const child = spawn(process.execPath, ["scripts/test-observer.mjs"], { cwd: root, detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    try { if ((await fetch(`${observerUrl}/health`)).ok) return true; } catch { /* retry */ }
  }
  return false;
}

function openViewer() {
  if (process.env.CI || process.env.TEST_OBSERVER_NO_OPEN || process.platform !== "darwin") return;
  const child = spawn("open", [observerUrl], { detached: true, stdio: "ignore" });
  child.unref();
}

function testNames(source) {
  return [...source.matchAll(/\btest\s*\(\s*(['"`])([\s\S]*?)\1/g)].map(match => match[2].replace(/\\(['"`])/g, "$1"));
}
function exactTestName(name) { return `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`; }

function run(command, args, file) {
  return new Promise(resolveRun => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, TEST_TRACE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let pending = "";
    let eventQueue = Promise.resolve();
    const traces = [];
    const consume = chunk => {
      const text = chunk.toString(); output += text; process.stdout.write(text); pending += text;
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? "";
      for (const line of lines) {
        const trace = line.match(/@@TEST_TRACE@@(\{.*\})/);
        if (trace) { try { traces.push(JSON.parse(trace[1])); } catch { /* ignore malformed diagnostics */ } continue; }
        const match = line.match(/^[✔✖] (.+?)(?: \([\d.]+ms\))?$/);
        if (match) {
          const evidence = traces.splice(0);
          eventQueue = eventQueue.then(() => request("/events", { type: line.startsWith("✔") ? "pass" : "fail", file, name: match[1], evidence }));
        }
      }
    };
    child.stdout.on("data", consume); child.stderr.on("data", consume);
    child.on("close", async code => { await eventQueue; resolveRun({ code: code ?? 1, output }); });
  });
}

const observerReady = await ensureObserver();
if (!observerReady) {
  console.error(`Could not start the live test observer at ${observerUrl}. Run \`node scripts/test-observer.mjs\` to see its startup error.`);
}
await request("/clear");
if (observerReady) openViewer();
const files = await discoverTestFiles(resolve(root, "tests"));
const nodeFiles = files.filter(path => !path.includes("/e2e/"));
const browserFiles = files.filter(path => path.includes("/e2e/"));
const runBrowser = process.argv.includes("--browser") || process.argv.includes("--all");
const runNode = !process.argv.includes("--browser") || process.argv.includes("--all");
await request("/events", { type: "start", name: `Discovered ${files.length} test files (${nodeFiles.length} Node, ${browserFiles.length} browser)` });
for (const file of files) {
  const display = relative(root, file);
  for (const name of testNames(await readFile(file, "utf8"))) await request("/events", { type: "registered", file: display, name });
}

const failures = [];
for (const file of runNode ? nodeFiles : []) {
  const display = relative(root, file);
  for (const name of testNames(await readFile(file, "utf8"))) {
    await request("/events", { type: "start", file: display, name });
    const result = await run(process.execPath, ["--experimental-strip-types", "--test", `--test-name-pattern=${exactTestName(name)}`, file], display);
    if (result.code) failures.push(`${display}: ${name}`);
  }
}
if (runBrowser && browserFiles.length) {
  await request("/events", { type: "start", name: `Running ${browserFiles.length} discovered browser spec(s)` });
  const result = await run("npx", ["playwright", "test", ...browserFiles.map(file => relative(root, file))], "browser");
  if (result.code) failures.push("browser tests");
}
await request("/events", { type: failures.length ? "fail" : "pass", name: failures.length ? `Finished with failures: ${failures.join(", ")}` : "All selected tests passed" });
if (failures.length) process.exitCode = 1;
