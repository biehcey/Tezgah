import { createServer, type AddressInfo, type Socket } from 'node:net';

/**
 * Şifre doğrulamasını ve tek kolonlu ad listesi sorgularını konuşan küçük bir Postgres taklidi
 * (wire protokolü v3, düz metin şifre). Gerçek Postgres olmadan `28P01` akışını sınamak için.
 */
export interface FakePostgres {
  port: number;
  /** Sunucunun kabul ettiği şifre; testte değiştirilebilir (ör. şifre sunucuda değişti). */
  password: string;
  /** Her sorguya dönen adlar (veritabanı ya da şema listesi). */
  names: string[];
  /** Denenen şifreler, sırasıyla. */
  attempts: string[];
  /** Açık oturumları düşürür (bağlantı koptu). */
  dropSessions(): void;
  close(): Promise<void>;
}

const SSL_REQUEST = 80877103;

export async function startFakePostgres({ password }: { password: string }): Promise<FakePostgres> {
  const sockets = new Set<Socket>();
  const fake: FakePostgres = {
    port: 0,
    password,
    names: ['postgres'],
    attempts: [],
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
      const rows = fake.names.map((name) => {
        const value = Buffer.from(name, 'utf8');
        return message('D', Buffer.concat([int16(1), int32(value.length), value]));
      });
      socket.write(
        Buffer.concat([
          message('T', Buffer.concat([int16(1), cstring('ad'), int32(0), int16(0), int32(25), int16(-1), int32(-1), int16(0)])),
          ...rows,
          message('C', cstring(`SELECT ${rows.length}`)),
          ready(),
        ]),
      );
    } else if (type === 'X') socket.end();
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

function errorResponse(code: string, text: string): Buffer {
  const field = (key: string, value: string) => Buffer.concat([Buffer.from(key), cstring(value)]);
  return message('E', Buffer.concat([field('S', 'FATAL'), field('V', 'FATAL'), field('C', code), field('M', text), Buffer.from([0])]));
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
