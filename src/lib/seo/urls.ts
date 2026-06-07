import { PostStatus } from '@prisma/client';

export const SITE_BASE_URL = 'https://bodytrainingguide.com';
export const SUPPORTED_POST_LOCALES = ['en', 'fr'] as const;

export type PostLocale = (typeof SUPPORTED_POST_LOCALES)[number];

export type PostUrlSource = {
  locale: string;
  slug: string;
  status?: PostStatus;
  isActive?: boolean;
  isIndexable?: boolean;
  publishedAt?: Date | string | null;
};

export type PostTranslationLink = {
  locale: PostLocale;
  slug: string;
  path: string;
  canonicalUrl: string;
};

export type PostHreflangLink = {
  hreflang: PostLocale | 'x-default';
  href: string;
};

export function isPostLocale(locale: unknown): locale is PostLocale {
  return typeof locale === 'string' && SUPPORTED_POST_LOCALES.includes(locale as PostLocale);
}

export function resolvePostLocale(locale: unknown): PostLocale {
  return isPostLocale(locale) ? locale : 'en';
}

export function buildPostPath(locale: string, slug: string): string {
  return locale === 'fr' ? `/fr/articles/${slug}` : `/articles/${slug}`;
}

export function buildPostCanonical(locale: string, slug: string): string {
  return `${SITE_BASE_URL}${buildPostPath(locale, slug)}`;
}

function isPublishedActiveIndexable(post: PostUrlSource, now = new Date()): boolean {
  if (post.status !== PostStatus.PUBLISHED || !post.isActive || !post.isIndexable) return false;
  if (!post.publishedAt) return false;
  return new Date(post.publishedAt) <= now;
}

export function buildPostTranslationLink(post: PostUrlSource): PostTranslationLink {
  const locale = resolvePostLocale(post.locale);
  return {
    locale,
    slug: post.slug,
    path: buildPostPath(locale, post.slug),
    canonicalUrl: buildPostCanonical(locale, post.slug)
  };
}

export function buildPostTranslations(currentPost: PostUrlSource, translations: PostUrlSource[]): PostTranslationLink[] {
  return translations
    .filter((translation) => translation.locale !== currentPost.locale)
    .filter((translation) => isPostLocale(translation.locale))
    .filter((translation) => isPublishedActiveIndexable(translation))
    .map(buildPostTranslationLink);
}

export function buildPostHreflang(currentPost: PostUrlSource, translations: PostUrlSource[]): PostHreflangLink[] {
  const eligiblePosts = [currentPost, ...translations]
    .filter((post) => isPostLocale(post.locale))
    .filter((post) => isPublishedActiveIndexable(post));
  const byLocale = new Map<PostLocale, PostUrlSource>();

  for (const post of eligiblePosts) {
    const locale = resolvePostLocale(post.locale);
    if (!byLocale.has(locale)) byLocale.set(locale, post);
  }

  const links: PostHreflangLink[] = [];
  for (const locale of SUPPORTED_POST_LOCALES) {
    const post = byLocale.get(locale);
    if (post) links.push({ hreflang: locale, href: buildPostCanonical(locale, post.slug) });
  }

  const englishPost = byLocale.get('en');
  if (englishPost) links.push({ hreflang: 'x-default', href: buildPostCanonical('en', englishPost.slug) });

  return links;
}
