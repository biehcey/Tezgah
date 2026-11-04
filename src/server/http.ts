import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 1024 * 1024;

export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** İstek gövdesi JSON değilse ya da çok büyükse döndürülecek durum. */
export class BodyError extends Error {
  constructor(readonly status: 400 | 413 | 415, message: string) {
    super(message);
  }
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new BodyError(415, 'İçerik türü application/json olmalı');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BodyError(413, 'İstek gövdesi çok büyük');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BodyError(400, 'Geçersiz JSON');
  }
}
