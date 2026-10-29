import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

/** Find every TypeScript Node or Playwright test below the supplied directory. */
export async function discoverTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await discoverTestFiles(path));
    else if (/\.(test|spec)\.ts$/.test(entry.name)) paths.push(path);
  }
  return paths.sort();
}
