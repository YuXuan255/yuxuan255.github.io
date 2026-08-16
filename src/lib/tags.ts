import { getPosts, type PostEntry } from "./posts";

export function tagSlug(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, "-");
}

export interface TagInfo {
  name: string;
  slug: string;
  posts: PostEntry[];
}

export async function getTags(): Promise<TagInfo[]> {
  const posts = await getPosts();
  const bySlug = new Map<string, TagInfo>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagSlug(tag);
      const info = bySlug.get(slug) ?? { name: tag, slug, posts: [] };
      info.posts.push(post);
      bySlug.set(slug, info);
    }
  }
  return [...bySlug.values()].sort((a, b) => {
    const byCount = b.posts.length - a.posts.length;
    return byCount !== 0 ? byCount : a.name.localeCompare(b.name);
  });
}
