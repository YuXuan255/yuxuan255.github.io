import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const srcDir = resolve("src/content");
const distDir = resolve("dist");
const errors = [];

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function isExternal(url) {
  return /^(https?:|mailto:|tel:|data:)/i.test(url) || url.startsWith("//");
}

function sortOut(url) {
  return url.split("#")[0].split("?")[0];
}

const mdFiles = walk(srcDir).filter((f) => f.endsWith(".md"));

for (const file of mdFiles) {
  const src = readFileSync(file, "utf8");
  const linkRe = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = linkRe.exec(src)) !== null) {
    const url = match[3];
    const base = file.replace(srcDir + "/", "");
    const clean = sortOut(url);
    if (isExternal(clean) || clean.startsWith("/") || clean.startsWith("#"))
      continue;
    const target = resolve(dirname(file), decodeURIComponent(clean));
    if (!existsSync(target)) {
      errors.push(`[${base}] broken markdown link: ${url}`);
    }
  }
}

const htmlFiles = walk(distDir).filter((f) => f.endsWith(".html"));

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const attrRe = /(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = attrRe.exec(html)) !== null) {
    const url = match[1];
    const clean = sortOut(url);
    if (isExternal(clean) || clean.startsWith("#")) continue;
    if (clean.startsWith("/")) {
      const target = join(distDir, clean);
      if (!existsSync(target)) {
        errors.push(
          `[${file.replace(distDir + "/", "")}] broken absolute link: ${url}`,
        );
      }
    } else {
      const target = resolve(dirname(file), decodeURIComponent(clean));
      if (!existsSync(target)) {
        errors.push(
          `[${file.replace(distDir + "/", "")}] broken relative link: ${url}`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Link check failed:");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `Link check passed (${mdFiles.length} markdown files, ${htmlFiles.length} html files).`,
);
