import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import matter from "gray-matter";

const contentDir = resolve("src/content");
const errors = [];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(contentDir);

for (const file of files) {
  const rel = file.replace(contentDir + "/", "");
  const { data } = matter(readFileSync(file, "utf8"));
  const dir = dirname(file).replace(contentDir + "/", "");

  if (!["writing", "journal"].includes(dir)) {
    errors.push(
      `[${rel}] content must be inside src/content/writing/ or src/content/journal/`,
    );
  }

  if (data.date === undefined || data.date === "") {
    errors.push(`[${rel}] missing or empty frontmatter field: date`);
  } else {
    const date = new Date(data.date);
    if (Number.isNaN(date.getTime())) {
      errors.push(`[${rel}] invalid date: ${data.date}`);
    } else if (date.getTime() > Date.now()) {
      errors.push(`[${rel}] date is in the future: ${data.date}`);
    }
  }

  if (dir === "journal") {
    if (data.featured !== undefined) {
      errors.push(`[${rel}] journal entries cannot have "featured"`);
    }
    if (data.tags !== undefined) {
      errors.push(`[${rel}] journal entries cannot have "tags"`);
    }
    if (data.draft !== undefined && typeof data.draft !== "boolean") {
      errors.push(`[${rel}] draft must be true or false`);
    }
    continue;
  }

  for (const field of ["title", "description"]) {
    if (data[field] === undefined || data[field] === "") {
      errors.push(`[${rel}] missing or empty frontmatter field: ${field}`);
    }
  }

  if (data.tags !== undefined && !Array.isArray(data.tags)) {
    errors.push(`[${rel}] tags must be a list`);
  }

  for (const boolField of ["draft", "featured"]) {
    if (data[boolField] !== undefined && typeof data[boolField] !== "boolean") {
      errors.push(`[${rel}] ${boolField} must be true or false`);
    }
  }

  if (data.featured === true && data.draft === true) {
    errors.push(`[${rel}] draft posts cannot be featured`);
  }
}

if (errors.length > 0) {
  console.error("Content check failed:");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(`Content check passed (${files.length} files).`);
