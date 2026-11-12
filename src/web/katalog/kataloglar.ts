import { useCallback, useMemo, useRef, useState } from 'react';
import type { Connection } from '../../core/baglanti';
import { catalogCompletion, typeMap, type Catalog, type CompletionConfig } from '../../core/katalog';
import { targetSchemas, type Target } from '../../core/veritabani-secimi';
import type { ApiClient } from '../api/client';

/**
 * Bir hedefin arayüzdeki katalog durumu. Yenilenirken ve okunamayınca önceki katalog (varsa)
 * kullanılmaya devam eder.
 */
export type CatalogEntry =
  | { durum: 'yukleniyor'; katalog: Catalog | null }
  | { durum: 'hazir'; katalog: Catalog }
  | { durum: 'hata'; hata: string; katalog: Catalog | null };

/**
 * Katalog isteğinin nedeni: `hedef` (panel / Ctrl+K ile seçildi), `calistir` (sekme çalıştırıldı),
 * `yenile` (↻), `tazelendi` (sunucu DDL commit'inden sonra tazeledi). İlk ikisi yalnızca katalog
 * yoksa ister.
 */
export type CatalogReason = 'hedef' | 'calistir' | 'yenile' | 'tazelendi';

export const catalogKey = ({ connectionId, database }: Target) => `${connectionId}\u0000${database}`;

/** `catalogKey`'in tersi. */
export function targetOfKey(key: string): Target {
  const at = key.indexOf('\u0000');
  return { connectionId: key.slice(0, at), database: key.slice(at + 1) };
}

/**
 * Hedef başına katalog; aynı hedefe bağlı sekmeler aynı kaydı paylaşır. Yalnızca `request` ile
 * (kullanıcı eylemi) doldurulur: geri gelen sekmeler kendiliğinden katalog okumaz.
 */
export function useCatalogs(api: ApiClient) {
  const [entries, setEntries] = useState<Readonly<Record<string, CatalogEntry>>>({});
  const current = useRef(entries);
  current.current = entries;
  /** Hedef başına son istek; atılan ya da yenisi gelen isteğin yanıtı yazılmaz. */
  const latest = useRef(new Map<string, number>());
  const counter = useRef(0);
  /** Hedef başına yoldaki okuma; aynı hedefi isteyen onu bekler. */
  const reading = useRef(new Map<string, Promise<Catalog>>());

  const write = useCallback((key: string, entry: CatalogEntry | null) => {
    const next = { ...current.current };
    if (entry) next[key] = entry;
    else delete next[key];
    current.current = next;
    setEntries(next);
  }, []);

  /**
   * Katalogu ister; okunan (ya da zaten olan) katalogla çözülür, okunamazsa reddedilir. Çağıranların
   * çoğu sonucu beklemez: durum `entries`'e yazılır.
   */
  const request = useCallback(
    (target: Target, reason: CatalogReason): Promise<Catalog> => {
      const key = catalogKey(target);
      const existing = current.current[key];
      if ((reason === 'hedef' || reason === 'calistir') && existing && existing.durum !== 'hata') {
        return reading.current.get(key) ?? Promise.resolve(existing.katalog!);
      }
      const id = ++counter.current;
      latest.current.set(key, id);
      write(key, { durum: 'yukleniyor', katalog: existing?.katalog ?? null });
      const read =
        reason === 'yenile' ? api.refreshCatalog(target.connectionId, target.database) : api.getCatalog(target.connectionId, target.database);
      reading.current.set(key, read);
      read.then(
        (katalog) => {
          if (latest.current.get(key) !== id) return;
          reading.current.delete(key);
          write(key, { durum: 'hazir', katalog });
        },
        (err: unknown) => {
          if (latest.current.get(key) !== id) return;
          reading.current.delete(key);
          const prev = current.current[key];
          write(key, { durum: 'hata', hata: err instanceof Error ? err.message : String(err), katalog: prev?.katalog ?? null });
        },
      );
      return read;
    },
    [api, write],
  );

  /**
   * Bağlantının kataloglarını atar. `reload`: atılanlardan bu veritabanlarında olanlar yeniden
   * istenir (seçim değişti; gizlenen veritabanına bağlanılmaz).
   */
  const drop = useCallback(
    (connectionId: string, { reload = [] }: { reload?: readonly string[] } = {}) => {
      const prefix = `${connectionId}\u0000`;
      const dropped = Object.keys(current.current).filter((k) => k.startsWith(prefix));
      for (const key of dropped) {
        latest.current.delete(key);
        reading.current.delete(key);
        write(key, null);
      }
      for (const key of dropped) {
        const database = key.slice(prefix.length);
        if (reload.includes(database)) request({ connectionId, database }, 'hedef');
      }
    },
    [write, request],
  );

  return useMemo(() => ({ entries, request, drop }), [entries, request, drop]);
}

export type Catalogs = ReturnType<typeof useCatalogs>;

/** Editör tamamlaması ve INSERT tip adları: Veritabanı seçiminin şu an görünür şemalarıyla. */
export interface CatalogUse {
  completion: CompletionConfig | null;
  tipAdlari: ReadonlyMap<number, string> | undefined;
}

export function catalogUse(entry: CatalogEntry | undefined, connection: Connection, database: string): CatalogUse {
  const katalog = entry?.katalog;
  if (!katalog) return { completion: null, tipAdlari: undefined };
  return { completion: catalogCompletion(katalog, targetSchemas(connection, database, katalog.semalar)), tipAdlari: typeMap(katalog) };
}
