import { expect } from 'vitest';
import type { TestServer } from './sunucu';

/** Gerçek zamanda kısa bekleme: sunucunun eldeki işi bitirmesi için. */
export const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

/** Koşul sağlanana kadar yoklar; `tries × everyMs` içinde sağlanmazsa hata. */
export async function eventually(check: () => boolean | Promise<boolean>, { tries = 200, everyMs = 25 } = {}): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await settle(everyMs);
  }
  throw new Error('koşul sağlanmadı');
}

/** Sahte Postgres'e giden bir bağlantı kaydeder (`fields` varsayılanların üzerine yazar); id döner. */
export async function addFakeConnection(t: TestServer, port: number, fields: Record<string, unknown> = {}): Promise<string> {
  const res = await t.api('POST', '/api/baglantilar', {
    name: 'Yerel',
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'gizli',
    sslmode: 'disable',
    ...fields,
  });
  expect(res.status).toBe(201);
  return res.body.connection.id;
}
