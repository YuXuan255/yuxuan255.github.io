import { getCollection, type CollectionEntry } from "astro:content";

export type PostEntry = CollectionEntry<"posts">;
export type JournalEntry = CollectionEntry<"journal">;

export async function getPosts(): Promise<PostEntry[]> {
  const posts = await getCollection("posts", ({ data }) => {
    if (import.meta.env.PROD) return !data.draft;
    return true;
  });
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getJournal(): Promise<JournalEntry[]> {
  const entries = await getCollection("journal", ({ data }) => {
    if (import.meta.env.PROD) return !data.draft;
    return true;
  });
  return entries.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}
