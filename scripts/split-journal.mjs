import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// Obsidian vault 中按月日志的位置(YYYY/log-YYMM.md)。路径为本机绝对路径,
// 本脚本只在本地运行,不参与 CI 构建。
const vaultJournalDir = resolve("/home/yuxuan/Desktop/YXDuVault/journal");
const outDir = resolve("src/content/journal");

function findVaultLogs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findVaultLogs(path));
    } else if (entry.name.startsWith("log-")) {
      files.push(path);
    }
  }
  return files.sort();
}

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
let files;
if (inputs.length > 0) {
  files = inputs.map((f) => resolve(f));
} else {
  if (!existsSync(vaultJournalDir)) {
    console.error(
      `[error] vault journal directory not found: ${vaultJournalDir}`,
    );
    process.exit(1);
  }
  files = findVaultLogs(vaultJournalDir);
}

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
    if (existsSync(out) && readFileSync(out, "utf8") === content) {
      console.log(`[same] ${basename(out)}`);
      continue;
    }
    writeFileSync(out, content);
    console.log(`[write] ${basename(out)} (${items.length} item(s))`);
    written++;
  }
}

console.log(`Done: ${written} written.`);
