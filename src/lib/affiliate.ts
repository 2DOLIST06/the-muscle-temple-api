import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
export type BannerMode = 'native' | 'isolated';
export type BannerInput = { source: string; name?: string; mode?: BannerMode };
export type ManagedBanner = BannerInput & { start: number; end: number; index: number; html: string };
const encode = (value: string) => encodeURIComponent(value).replace(/'/g, '%27');
export function decodeAffiliate(value: string) {
  try { return decodeURIComponent(value); } catch { throw new Error('Code de bannière encodé invalide.'); }
}
export function makeBanner({ source, name = '', mode = 'native' }: BannerInput) {
  return `<aside class="affiliate-block affiliate-block--banner" data-affiliate-block="banner" data-affiliate-source="${encode(source)}" data-affiliate-name="${encode(name)}" data-affiliate-mode="${mode}" contenteditable="false">Bannière d’affiliation</aside>`;
}
export function getBanners(html: string): ManagedBanner[] {
  const banners: ManagedBanner[] = [];
  function walk(node: Node) {
    if ('attrs' in node && node.attrs.some(a => a.name === 'data-affiliate-block' && a.value === 'banner')) {
      const loc = node.sourceCodeLocation;
      if (!loc?.startTag || !loc.endTag) throw new Error('Une ancienne bannière est mal fermée. Corrigez-la dans l’article.');
      const attr = (name: string) => node.attrs.find(a => a.name === name)?.value;
      const encoded = attr('data-affiliate-source');
      banners.push({ start: loc.startOffset, end: loc.endOffset, index: banners.length,
        html: html.slice(loc.startOffset, loc.endOffset),
        source: encoded !== undefined ? decodeAffiliate(encoded) : html.slice(loc.startTag.endOffset, loc.endTag.startOffset),
        name: decodeAffiliate(attr('data-affiliate-name') ?? ''),
        mode: attr('data-affiliate-mode') === 'isolated' ? 'isolated' : 'native' });
      return;
    }
    if ('childNodes' in node) node.childNodes.forEach(walk);
    if ('content' in node) walk(node.content);
  }
  walk(parseFragment(html, { sourceCodeLocationInfo: true }));
  return banners.sort((a, b) => a.start - b.start).map((b, index) => ({ ...b, index }));
}
export function inertBanners(html: string) {
  return getBanners(html).reverse().reduce((result, b) => result.slice(0, b.start) + makeBanner(b) + result.slice(b.end), html);
}
export function applyBanner(html: string, input: BannerInput, targetIndex?: number) {
  const banners = getBanners(html);
  if (banners.length > 1 && targetIndex === undefined) throw new Error('Plusieurs bannières : choisissez explicitement celle à remplacer dans l’article.');
  const block = makeBanner(input);
  if (!banners.length) return html + block;
  const target = banners[targetIndex ?? 0];
  if (!target) throw new Error('La bannière choisie n’existe plus. Rechargez l’article.');
  return html.slice(0, target.start) + block + html.slice(target.end);
}
// Compare executable material as well as encoded banners, regardless of where it is stored.
export function activeContentSignature(html: string) {
  const parts = getBanners(html).map(b => JSON.stringify([b.source, b.mode]));
  function walk(node: Node) {
    if ('attrs' in node) {
      if (node.attrs.some(a => a.name === 'data-affiliate-block' && a.value === 'banner')) return;
      if (['script', 'iframe', 'object', 'embed', 'style', 'link', 'base', 'meta'].includes(node.tagName)) {
        const loc = node.sourceCodeLocation;
        if (loc) parts.push(html.slice(loc.startOffset, loc.endOffset));
      }
      for (const a of node.attrs) if (/^on/i.test(a.name) || /^(?:javascript|data):/i.test(a.value.trim()) || a.name === 'srcdoc') parts.push(a.name + '=' + a.value);
    }
    if ('childNodes' in node) node.childNodes.forEach(walk);
    if ('content' in node) walk(node.content);
  }
  walk(parseFragment(html, { sourceCodeLocationInfo: true }));
  return parts.sort().join('\n');
}
