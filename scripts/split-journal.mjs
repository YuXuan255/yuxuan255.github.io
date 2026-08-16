import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const draftsDir = resolve("drafts");
const outDir = resolve("src/content/journal");

function parseLog(file) {
  const name = basename(file);
  const match = name.match(/^log-(\d{2})(\d{2})\.md$/);
  if (!match) {
    console.error(`[skip] ${name}: filename must be log-YYMM.md`);
    return null;
  }
  const year = 2000 + Number(match[1]);
  const month = match[2];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  const days = [];
  let current = null;
  for (const line of lines) {
    const dateMatch = line.match(/^-\s*(\d{1,2})\.(\d{1,2})\s*$/);
    if (dateMatch) {
      const day = dateMatch[2].padStart(2, "0");
      current = { date: `${year}-${month}-${day}`, items: [] };
      days.push(current);
      continue;
    }
    const itemMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (itemMatch && current) {
      current.items.push(itemMatch[1].trim());
    }
  }
  return days;
}

function renderBody(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

const inputs = process.argv.slice(2);
const files =
  inputs.length > 0
    ? inputs.map((f) => resolve(f))
    : readdirSync(draftsDir)
        .filter((f) => f.startsWith("log-"))
        .map((f) => join(draftsDir, f));

let written = 0;
for (const file of files) {
  const days = parseLog(file);
  if (!days) continue;
  for (const { date, items } of days) {
    if (items.length === 0) continue;
    const out = join(outDir, `${date}.md`);
    const content = `---
date: ${date}
draft: false
---

${renderBody(items)}
`;
    writeFileSync(out, content);
    console.log(`[write] ${basename(out)} (${items.length} item(s))`);
    written++;
  }
}

console.log(`Done: ${written} written (overwrite mode).`);
