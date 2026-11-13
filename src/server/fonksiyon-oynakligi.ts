import { parseVolatilityRequest, type Volatility, type VolatilityResponse } from '../core/kolon-ekle';
import type { SettingsStore } from './ayar-deposu';
import { catalogQuery, targetPostRoute, targetQueryError, type PoolManager } from './havuzlar';
import { json, readJson } from './http';

/**
 * Ad başına en oynak aşırı yükleme (`v` > `s` > `i`): ALTER'ın varsayılanı hangi aşırı yüklemeyi
 * çağıracağı burada bilinmez; uyarı temkinli olur. Şema ayırt edilmez.
 */
const VOLATILITY_SQL = `SELECT p.proname::text AS ad,
    CASE WHEN bool_or(p.provolatile = 'v') THEN 'v' WHEN bool_or(p.provolatile = 's') THEN 's' ELSE 'i' END AS oynaklik
  FROM pg_catalog.pg_proc p WHERE p.proname = ANY($1::text[]) GROUP BY p.proname`;

const PATH = /^\/api\/baglantilar\/([^/]+)\/veritabanlari\/([^/]+)\/fonksiyon-oynakligi$/;

/**
 * `POST …/veritabanlari/:db/fonksiyon-oynakligi`: "+ Kolon" lint'i için ad başına `i|s|v`. Kısa
 * süreli client (oturum sayılmaz); boş listede hedefe bağlanılmaz.
 */
export function createVolatilityRoutes({ store, pools }: { store: SettingsStore; pools: PoolManager }) {
  return targetPostRoute(store, PATH, async (req, res, connection, database) => {
    const request = parseVolatilityRequest(await readJson(req));
    if (!request) return json(res, 400, { hata: 'Geçersiz fonksiyon oynaklığı isteği' });
    const oynaklik: VolatilityResponse['oynaklik'] = {};
    if (request.fonksiyonlar.length > 0) {
      const rows = await pools.withClient(connection, database, async (client, discard) => {
        try {
          return await catalogQuery<{ ad: string; oynaklik: Volatility }>(client, VOLATILITY_SQL, [request.fonksiyonlar]);
        } catch (err) {
          discard();
          throw targetQueryError(err, 'Fonksiyon oynaklığı');
        }
      });
      for (const row of rows) oynaklik[row.ad] = row.oynaklik;
    }
    json(res, 200, { oynaklik } satisfies VolatilityResponse);
  });
}
