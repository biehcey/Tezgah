import { createServer, type AddressInfo, type Socket } from 'node:net';

/**
 * Şifre doğrulamasını ve basit sorgu protokolünü konuşan küçük bir Postgres taklidi (wire protokolü
 * v3, düz metin şifre): her sorgu `resultFor`'un verdiği sonucu (yoksa tek kolonlu ad listesini)
 * döner ya da `failOn`'un verdiği hatayla düşer. Parametreli sorgular (extended protocol) yalnızca kaydedilir ve satırsız döner. Gerçek Postgres olmadan `28P01` akışını ve script çalıştırmanın kayıtlarını sınamak için.
 */
export interface FakePostgres {
  port: number;
  /** Sunucunun kabul ettiği şifre; testte değiştirilebilir (ör. şifre sunucuda değişti). */
  password: string;
  /** Her sorguya dönen adlar (veritabanı ya da şema listesi). */
  names: string[];
  /** Denenen şifreler, sırasıyla. */
  attempts: string[];
  /** Gelen sorgular, sırasıyla. */
  queries: string[];
  /** Sorgu bu hatayla düşsün mü; `undefined` dönerse sorgu başarılıdır. */
  failOn: (sql: string) => { code: string; message: string; position?: number } | undefined;
  /** Sorgunun sonucu; `undefined` dönerse `names` listesi döner. Değerler metindir, NULL `null`. */
  resultFor: (sql: string) => FakeResult | undefined;
  /** Sorgu hiç yanıtlanmasın mı (uzun süren ifade; iptal edilene kadar çalışıyor görünür). */
  hangOn: (sql: string) => boolean;
  /** Açık oturumları düşürür (bağlantı koptu). */
  dropSessions(): void;
  close(): Promise<void>;
}

export interface FakeResult {
  columns: string[];
  rows: (string | null)[][];
  /** Komut etiketi, ör. `UPDATE 3`. */
  command: string;
}

const SSL_REQUEST = 80877103;

export async function startFakePostgres({ password }: { password: string }): Promise<FakePostgres> {
  const sockets = new Set<Socket>();
  const fake: FakePostgres = {
    port: 0,
    password,
    names: ['postgres'],
    attempts: [],
    queries: [],
    failOn: () => undefined,
    resultFor: () => undefined,
    hangOn: () => false,
    dropSessions: () => {
      for (const socket of sockets) socket.destroy();
    },
    close: () =>
      new Promise((resolve) => {
        fake.dropSessions();
        server.close(() => resolve());
      }),
  };

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    let started = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!started) {
          if (buffer.length < 8) return;
          const length = buffer.readInt32BE(0);
          if (buffer.length < length) return;
          const code = buffer.readInt32BE(4);
          buffer = buffer.subarray(length);
          if (code === SSL_REQUEST) {
            socket.write('N');
            continue;
          }
          started = true;
          socket.write(message('R', int32(3))); // AuthenticationCleartextPassword
          continue;
        }
        if (buffer.length < 5) return;
        const type = String.fromCharCode(buffer[0]!);
        const length = buffer.readInt32BE(1);
        if (buffer.length < 1 + length) return;
        const body = buffer.subarray(5, 1 + length);
        buffer = buffer.subarray(1 + length);
        handle(socket, type, body);
      }
    });
  });

  function handle(socket: Socket, type: string, body: Buffer) {
    if (type === 'p') {
      const offered = body.subarray(0, body.indexOf(0)).toString('utf8');
      fake.attempts.push(offered);
      if (offered !== fake.password) {
        socket.end(errorResponse('28P01', 'password authentication failed for user "postgres"'));
        return;
      }
      socket.write(Buffer.concat([message('R', int32(0)), message('K', Buffer.concat([int32(1), int32(2)])), ready()]));
    } else if (type === 'Q') {
      const sql = body.subarray(0, body.indexOf(0)).toString('utf8');
      fake.queries.push(sql);
      if (fake.hangOn(sql)) return;
      const failure = fake.failOn(sql);
      if (failure) {
        socket.write(Buffer.concat([errorResponse(failure.code, failure.message, 'ERROR', failure.position), ready()]));
        return;
      }
      const result = fake.resultFor(sql) ?? {
        columns: ['ad'],
        rows: fake.names.map((name) => [name]),
        command: `SELECT ${fake.names.length}`,
      };
      const column = (name: string) => Buffer.concat([cstring(name), int32(0), int16(0), int32(25), int16(-1), int32(-1), int16(0)]);
      const cell = (value: string | null) => {
        if (value === null) return int32(-1);
        const bytes = Buffer.from(value, 'utf8');
        return Buffer.concat([int32(bytes.length), bytes]);
      };
      const rows = result.rows.map((row) => message('D', Buffer.concat([int16(row.length), ...row.map(cell)])));
      const description = result.columns.length > 0 ? [message('T', Buffer.concat([int16(result.columns.length), ...result.columns.map(column)]))] : [];
      socket.write(Buffer.concat([...description, ...rows, message('C', cstring(result.command)), ready()]));
    } else if (type === 'P') {
      // Extended protocol (parametreli sorgu): yalnızca kaydedilir, satırsız başarılı döner.
      const sql = body.subarray(body.indexOf(0) + 1);
      fake.queries.push(sql.subarray(0, sql.indexOf(0)).toString('utf8'));
      socket.write(message('1', Buffer.alloc(0)));
    } else if (type === 'B') socket.write(message('2', Buffer.alloc(0)));
    else if (type === 'D') socket.write(message('n', Buffer.alloc(0)));
    else if (type === 'E') socket.write(message('C', cstring('SELECT 0')));
    else if (type === 'S') socket.write(ready());
    else if (type === 'X') socket.end();
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.port = (server.address() as AddressInfo).port;
  return fake;
}

function message(type: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);
}

function ready(): Buffer {
  return message('Z', Buffer.from('I'));
}

function errorResponse(code: string, text: string, severity = 'FATAL', position?: number): Buffer {
  const field = (key: string, value: string) => Buffer.concat([Buffer.from(key), cstring(value)]);
  const fields = [field('S', severity), field('V', severity), field('C', code), field('M', text)];
  if (position !== undefined) fields.push(field('P', String(position)));
  return message('E', Buffer.concat([...fields, Buffer.from([0])]));
}

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, 'utf8'), Buffer.from([0])]);
}

function int32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value);
  return b;
}

function int16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(value);
  return b;
}
