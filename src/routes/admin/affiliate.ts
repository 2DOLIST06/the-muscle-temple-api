import type { FastifyPluginAsync } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { requireRole } from '../../lib/auth.js';
import { applyBanner, getBanners } from '../../lib/affiliate.js';

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  source: z.string().min(1).max(100_000).refine(s => s.trim().length > 0, 'Code vide.'),
  name: z.string().max(200).default(''),
  mode: z.enum(['native', 'isolated']).default('native')
});

export const affiliateRoutes: FastifyPluginAsync = async (app) => {
  app.post('/posts/affiliate-banner', { preHandler: requireRole([UserRole.ADMIN]) }, async (request) => {
    const { ids, ...banner } = schema.parse(request.body);
    const results: Array<{ id: string; status: 'modified' | 'unchanged' | 'failed'; message?: string }> = [];
    for (const id of new Set(ids)) {
      try {
        let completed = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const post = await app.prisma.post.findUnique({ where: { id } });
          if (!post) throw new Error('Article introuvable.');
          const json = post.contentJson;
          const doc = json && typeof json === 'object' && !Array.isArray(json) && typeof json.html === 'string' ? json : null;
          if (json && !doc) throw new Error('Format de contenu structuré non pris en charge : ouvrez cet article dans l’éditeur.');
          if (doc && post.contentHtml != null && (doc.html as string).trim() !== post.contentHtml.trim()) throw new Error('Le corps HTML et le document structuré divergent. Réconciliez le contenu dans l’article avant l’action en lot.');
          const html = post.contentHtml ?? (doc ? doc.html as string : post.contentMarkdown ?? '');
          const existing = getBanners(html);
          if (existing.length > 1) throw new Error(`${existing.length} anciennes bannières : ouvrez l’article et choisissez celle à remplacer ou supprimez les blocs en trop.`);
          if (existing.length === 1 && existing[0].source === banner.source && existing[0].name === banner.name && existing[0].mode === banner.mode) {
            results.push({ id, status: 'unchanged' }); completed = true; break;
          }
          const nextHtml = applyBanner(html, banner);
          const updated = await app.prisma.post.updateMany({
            where: { id, updatedAt: post.updatedAt },
            data: { updatedAt: new Date(Math.max(Date.now(), post.updatedAt.getTime() + 1)), contentHtml: nextHtml, contentMarkdown: nextHtml, contentJson: { ...(doc ?? { type: 'doc' }), html: nextHtml } }
          });
          if (updated.count) { results.push({ id, status: 'modified' }); completed = true; break; }
        }
        if (!completed) throw new Error('Article modifié simultanément. Réessayez.');
      } catch (error) {
        results.push({ id, status: 'failed', message: error instanceof Error ? error.message : 'Échec de mise à jour.' });
      }
    }
    return { data: { results, modified: results.filter(r => r.status === 'modified').length,
      unchanged: results.filter(r => r.status === 'unchanged').length, failed: results.filter(r => r.status === 'failed').length } };
  });
};
