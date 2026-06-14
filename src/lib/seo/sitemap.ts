import { PostStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  SITE_BASE_URL,
  SUPPORTED_POST_LOCALES,
  buildAuthorCanonical,
  buildCategoryCanonical,
  buildPageCanonical,
  buildPostCanonical
} from './urls.js';

type SitemapEntry = {
  loc: string;
  lastmod?: Date | string | null;
  changefreq?: 'daily' | 'weekly' | 'monthly';
  priority?: number;
};

const STATIC_PAGE_KEYS = ['home', 'articles', 'categories', 'authors'] as const;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatLastmod(value: Date | string): string {
  return new Date(value).toISOString();
}

function renderSitemapEntry(entry: SitemapEntry): string {
  const tags = [`    <loc>${escapeXml(entry.loc)}</loc>`];

  if (entry.lastmod) tags.push(`    <lastmod>${formatLastmod(entry.lastmod)}</lastmod>`);
  if (entry.changefreq) tags.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  if (entry.priority != null) tags.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);

  return `  <url>\n${tags.join('\n')}\n  </url>`;
}

function renderSitemap(entries: SitemapEntry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(renderSitemapEntry).join('\n')}\n</urlset>\n`;
}

export async function buildSitemapXml(prisma: PrismaClient): Promise<string> {
  const now = new Date();
  const indexablePostWhere = {
    status: PostStatus.PUBLISHED,
    isActive: true,
    isIndexable: true,
    publishedAt: { lte: now }
  };

  const [posts, categories, authors] = await Promise.all([
    prisma.post.findMany({
      where: indexablePostWhere,
      select: { locale: true, slug: true, updatedAt: true, publishedAt: true },
      orderBy: [{ publishedAt: 'desc' }]
    }),
    prisma.category.findMany({
      where: { posts: { some: indexablePostWhere } },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' }
    }),
    prisma.author.findMany({
      where: { posts: { some: indexablePostWhere } },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' }
    })
  ]);

  const staticEntries: SitemapEntry[] = SUPPORTED_POST_LOCALES.flatMap((locale) =>
    STATIC_PAGE_KEYS.map((pageKey) => ({
      loc: buildPageCanonical(locale, pageKey),
      changefreq: pageKey === 'home' || pageKey === 'articles' ? 'daily' : 'weekly',
      priority: pageKey === 'home' ? 1 : 0.8
    }))
  );

  const postEntries: SitemapEntry[] = posts.map((post) => ({
    loc: buildPostCanonical(post.locale, post.slug),
    lastmod: post.updatedAt ?? post.publishedAt,
    changefreq: 'monthly',
    priority: 0.7
  }));

  const categoryEntries: SitemapEntry[] = SUPPORTED_POST_LOCALES.flatMap((locale) =>
    categories.map((category) => ({
      loc: buildCategoryCanonical(locale, category.slug),
      lastmod: category.updatedAt,
      changefreq: 'weekly',
      priority: 0.6
    }))
  );

  const authorEntries: SitemapEntry[] = SUPPORTED_POST_LOCALES.flatMap((locale) =>
    authors.map((author) => ({
      loc: buildAuthorCanonical(locale, author.slug),
      lastmod: author.updatedAt,
      changefreq: 'monthly',
      priority: 0.5
    }))
  );

  const entries = [...staticEntries, ...postEntries, ...categoryEntries, ...authorEntries].filter((entry) => entry.loc.startsWith(SITE_BASE_URL));

  return renderSitemap(entries);
}
