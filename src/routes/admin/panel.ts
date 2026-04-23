import { FastifyPluginAsync } from 'fastify';

const page = (title: string, content: string, scripts = '') => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title>
<style>
body{font-family:Inter,Arial,sans-serif;max-width:1040px;margin:0 auto;padding:2rem;background:#f9fafb;color:#111827}
.card{background:white;border-radius:12px;padding:1rem 1.2rem;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:1rem}
input,select,textarea,button{width:100%;padding:.7rem;margin:.3rem 0;border:1px solid #d1d5db;border-radius:8px}
button{background:#111827;color:white;cursor:pointer} h1,h2{margin:.2rem 0 1rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1rem}
.row{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
small{color:#6b7280}
</style></head><body>${content}${scripts}</body></html>`;

export const adminPanelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/admin', async (_, reply) => reply.type('text/html').send(page('Admin Login', `
    <div class="card">
      <h1>The Muscle Temple - Admin</h1>
      <form id="loginForm">
        <input type="email" name="email" placeholder="Email admin" required />
        <input type="password" name="password" placeholder="Mot de passe" required />
        <button type="submit">Se connecter</button>
      </form>
      <small>Le token JWT est stocké en localStorage pour cette version.</small>
    </div>
  `, `<script>
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const r = await fetch('/admin-api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:form.get('email'),password:form.get('password')})});
    const j = await r.json();
    if(!r.ok){alert(j.message||'Erreur auth');return;}
    localStorage.setItem('adminToken', j.data.token);
    location.href='/admin/dashboard';
  });
  </script>`)));

  fastify.get('/admin/dashboard', async (_, reply) => reply.type('text/html').send(page('Dashboard', `
    <h1>Dashboard Admin</h1>
    <div class="grid" id="stats"></div>

    <div class="card"><h2>Créer un article</h2>
      <form id="postForm">
      <input name="title" placeholder="Titre" required />
      <textarea name="excerpt" placeholder="Résumé"></textarea>
      <textarea name="contentMarkdown" placeholder="Contenu markdown" rows="8" required></textarea>
      <div class="row"><input name="authorId" placeholder="Author ID" required /><input name="categoryId" placeholder="Category ID" /></div>
      <div class="row"><select name="status"><option value="DRAFT">Brouillon</option><option value="PUBLISHED">Publié</option></select><input name="readingTimeMinutes" type="number" placeholder="Temps de lecture" /></div>
      <input name="tagIds" placeholder="Tag IDs (séparés par virgules)" />
      <input name="relatedPostIds" placeholder="Related Post IDs (séparés par virgules)" />
      <h3>SEO</h3>
      <input name="seoTitle" placeholder="SEO title" /><textarea name="seoDescription" placeholder="SEO description"></textarea><input name="canonicalUrl" placeholder="Canonical URL" />
      <button type="submit">Créer</button></form>
    </div>

    <div class="card"><h2>Articles</h2><div id="postsList"></div></div>
    <div class="card"><h2>Catégories</h2><div id="categoriesList"></div></div>
    <div class="card"><h2>Auteurs</h2><div id="authorsList"></div></div>
  `, `<script>
  const token = localStorage.getItem('adminToken');
  if(!token) location.href='/admin';
  const headers = {'content-type':'application/json','authorization':'Bearer '+token};

  async function boot(){
    const [dash, posts, categories, authors] = await Promise.all([
      fetch('/admin-api/dashboard',{headers}), fetch('/admin-api/posts',{headers}), fetch('/admin-api/categories',{headers}), fetch('/admin-api/authors',{headers})
    ]);
    if(dash.status===401){localStorage.removeItem('adminToken'); location.href='/admin';return;}
    const d = await dash.json();
    document.getElementById('stats').innerHTML = Object.entries(d.data).map(([k,v])=>`<div class='card'><b>${k}</b><div>${v}</div></div>`).join('');
    document.getElementById('postsList').innerHTML = (await posts.json()).data.map(p=>`<div><b>${p.title}</b> (${p.status}) - ${p.slug}</div>`).join('') || 'Aucun article';
    document.getElementById('categoriesList').innerHTML = (await categories.json()).data.map(c=>`<div>${c.name} - ${c.slug}</div>`).join('') || 'Aucune catégorie';
    document.getElementById('authorsList').innerHTML = (await authors.json()).data.map(a=>`<div>${a.name} - ${a.slug}</div>`).join('') || 'Aucun auteur';
  }
  boot();

  document.getElementById('postForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {
      title: f.get('title'), excerpt: f.get('excerpt') || undefined, contentMarkdown: f.get('contentMarkdown'),
      authorId: f.get('authorId'), categoryId: f.get('categoryId') || null, status: f.get('status'),
      readingTimeMinutes: f.get('readingTimeMinutes') ? Number(f.get('readingTimeMinutes')) : null,
      tagIds: String(f.get('tagIds') ?? '').split(',').map(function(x){return x.trim();}).filter(Boolean),
      relatedPostIds: String(f.get('relatedPostIds') ?? '').split(',').map(function(x){return x.trim();}).filter(Boolean),
      seo: { title: f.get('seoTitle') || '', description: f.get('seoDescription') || '', canonicalUrl: f.get('canonicalUrl') || '', noIndex: false }
    };
    const res = await fetch('/admin-api/posts',{method:'POST',headers,body:JSON.stringify(body)});
    const json = await res.json();
    if(!res.ok){alert(json.message || JSON.stringify(json)); return;}
    alert('Article créé');
    e.target.reset();
    boot();
  });
  </script>`)));
};
