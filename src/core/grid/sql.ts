/**
 * Grid'in ürettiği SQL'in yapı taşları: literal ve tanımlayıcı. "INSERT olarak kopyala" ve
 * Bekleyen değişiklik SQL'i aynı üreticiyi kullanır ki önizlenen, kayda geçen ve kopyalanan SQL
 * aynı olsun. `standard_conforming_strings` açık varsayılır (PG 9.1'den beri varsayılan): ters
 * bölü literal içinde kaçış değildir.
 */

/** Değer `'…'::tip` (tip adı yoksa `'…'`); tek tırnak ikilenir. NULL tipten bağımsız `NULL`. */
export function sqlLiteral(value: string | null, tip?: string | null): string {
  if (value === null) return 'NULL';
  const quoted = `'${value.replaceAll("'", "''")}'`;
  return tip ? `${quoted}::${tip}` : quoted;
}

/** Şemayla nitelenmiş ya da nitelenmemiş tablo adı; parçalar ham (tırnaksız) hâlindedir. */
export interface TableName {
  sema?: string;
  ad: string;
}

/** Tanımlayıcı her zaman çift tırnağa alınır (büyük harf, boşluk, anahtar kelime güvenli); `"` ikilenir. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Her parçası tırnaklı tablo adı (`"s"."t"`); `to_regclass`'a da bu biçimde verilir. */
export function qualifiedName({ sema, ad }: TableName): string {
  return sema === undefined ? quoteIdent(ad) : `${quoteIdent(sema)}.${quoteIdent(ad)}`;
}
