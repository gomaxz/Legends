import http from 'node:http';
import { createBridge } from './bridge.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = process.env.CATALOG_FILE || path.join(DIR, 'data', 'catalog.json');
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KINDS = new Set(['geometry', 'texture', 'animations']);

function respond(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function loadCatalog() {
  const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  if (raw.version !== 1 || !Array.isArray(raw.models)) throw new Error('catalog.json requiere version=1 y models=array');
  const ids = new Set();
  for (const model of raw.models) {
    if (typeof model.id !== 'string' || !ID_PATTERN.test(model.id) || ids.has(model.id)) {
      throw new Error('ID inválido o duplicado en el catálogo');
    }
    ids.add(model.id);
    for (const [kind, asset] of Object.entries(model.assets ?? {})) {
      if (!KINDS.has(kind) || !asset || typeof asset.path !== 'string' || !asset.path ||
          asset.path.includes('..') || asset.path.startsWith('/') || asset.path.includes('\\') ||
          typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(asset.sha256)) {
        throw new Error(`Asset inválido para ${model.id}/${kind}`);
      }
    }
  }
  return raw;
}

const catalog = loadCatalog();

async function verifySupabaseUser(bearer) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('SUPABASE_AUTH_NOT_CONFIGURED');
  if (!bearer || !bearer.startsWith('Bearer ')) return null;
  const token = bearer.slice(7).trim();
  if (!token || token.length > 8192) return null;
  const resp = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) return null;
  const user = await resp.json();
  return user && typeof user.id === 'string' ? user : null;
}

async function signObject(assetPath) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET || 'legends-ysm-models';
  if (!url || !serviceKey) throw new Error('SUPABASE_STORAGE_NOT_CONFIGURED');
  const target = `${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${assetPath.split('/').map(encodeURIComponent).join('/')}`;
  const resp = await fetch(target, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 120 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Supabase Storage respondió ${resp.status}`);
  const signed = await resp.json();
  if (!signed.signedURL?.startsWith('/object/sign/')) throw new Error('Respuesta inválida de Supabase Storage');
  return `${url}/storage/v1${signed.signedURL}`;
}

export function createApp() {
  const bridge = createBridge({ authenticate: verifySupabaseUser });
  return http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const pathname = parsed.pathname;
      if (await bridge.handle(req, res, pathname)) return;
      if (req.method !== 'GET') return respond(res, 405, { error: 'METHOD_NOT_ALLOWED' });

      if (pathname === '/health') return respond(res, 200, { ok: true, service: 'legends-ysm-api', version: '0.1.0' });

      if (pathname === '/api/v1/models') {
        return respond(res, 200, {
          version: catalog.version,
          count: catalog.models.length,
          models: catalog.models.map(({ id, name, revision, assets }) => ({
            id, name, revision,
            availableFiles: Object.keys(assets ?? {}),
            // Disponibilidad remota NO implica que YSM haya cargado el modelo.
            clientLoaded: null,
          })),
        });
      }

      const match = /^\/api\/v1\/models\/([a-z0-9_-]+)\/assets\/(geometry|texture|animations)$/.exec(pathname);
      if (match) {
        const [, modelId, kind] = match;
        const model = catalog.models.find((m) => m.id === modelId);
        const asset = model?.assets?.[kind];
        if (!asset) return respond(res, 404, { error: 'ASSET_NOT_FOUND' });
        // Seguridad: esta API es una maqueta de distribución, NO autentica el clan de Legends.
        // Descargas deshabilitadas hasta integrar de verdad el verificador de acceso de Legends.
        if (process.env.ENABLE_DOWNLOADS !== 'true') return respond(res, 503, { error: 'DOWNLOADS_DISABLED_UNTIL_AUTH_INTEGRATION' });
        const user = await verifySupabaseUser(req.headers.authorization);
        if (!user) return respond(res, 401, { error: 'SUPABASE_AUTH_REQUIRED' });
        const signedUrl = await signObject(asset.path);
        return respond(res, 200, { url: signedUrl, expiresInSeconds: 120, sha256: asset.sha256 }, {
          'Cache-Control': 'no-store',
        });
      }

      return respond(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      console.error('[Legends-YSM-API]', error?.message || String(error));
      return respond(res, 500, { error: 'INTERNAL_ERROR' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '0.0.0.0', () => console.log(`Legends YSM API v0.1 en puerto ${port}`));
}
