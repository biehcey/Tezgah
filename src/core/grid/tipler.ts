/**
 * Sonuç kolonlarının tip OID'lerinden literal'e eklenecek tip adı. Yaygın yerleşik tipler burada
 * sabittir (OID'leri `pg_type.dat`'ta sabit); diğerleri katalogdan gelen eşlemeyle çözülür. Adlar
 * `format_type` biçimindedir ve olduğu gibi yazılır (eşlemedeki adlar gerekiyorsa zaten tırnaklıdır).
 *
 * Uzunluk/duyarlık eki (typmod) sonuçta gelmez; ekiyle anlam değiştiren tipler eksiz adıyla yazılır:
 * `::character` değeri tek karaktere kırpar (`bpchar` kırpmaz), `::bit` uzunluk uyuşmazlığında hata
 * verir (`varbit` vermez, kolona atamada `bit`'e döner). Yerleşikler katalog eşlemesinden önce
 * gelir ki `format_type`'ın `character`/`bit` adları bu korumayı bozmasın.
 */
const BUILTIN: ReadonlyMap<number, string> = new Map([
  [16, 'boolean'],
  [17, 'bytea'],
  [18, '"char"'],
  [19, 'name'],
  [20, 'bigint'],
  [21, 'smallint'],
  [23, 'integer'],
  [25, 'text'],
  [26, 'oid'],
  [114, 'json'],
  [142, 'xml'],
  [650, 'cidr'],
  [700, 'real'],
  [701, 'double precision'],
  [790, 'money'],
  [829, 'macaddr'],
  [869, 'inet'],
  [1042, 'bpchar'],
  [1043, 'character varying'],
  [1082, 'date'],
  [1083, 'time without time zone'],
  [1114, 'timestamp without time zone'],
  [1184, 'timestamp with time zone'],
  [1186, 'interval'],
  [1266, 'time with time zone'],
  [1560, 'varbit'],
  [1700, 'numeric'],
  [2950, 'uuid'],
  [3802, 'jsonb'],
  // Diziler
  [199, 'json[]'],
  [1000, 'boolean[]'],
  [1001, 'bytea[]'],
  [1005, 'smallint[]'],
  [1007, 'integer[]'],
  [1009, 'text[]'],
  [1014, 'bpchar[]'],
  [1015, 'character varying[]'],
  [1016, 'bigint[]'],
  [1021, 'real[]'],
  [1022, 'double precision[]'],
  [1115, 'timestamp without time zone[]'],
  [1182, 'date[]'],
  [1185, 'timestamp with time zone[]'],
  [1231, 'numeric[]'],
  [1561, 'varbit[]'],
  [2951, 'uuid[]'],
  [3807, 'jsonb[]'],
]);

/** Tip OID'sinin adı: önce yerleşikler, sonra `katalog` (OID → ad). Çözülemezse `null`. */
export function typeName(oid: number, katalog?: ReadonlyMap<number, string>): string | null {
  return BUILTIN.get(oid) ?? katalog?.get(oid) ?? null;
}
