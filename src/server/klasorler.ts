import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { deleteFolder, parseFolderName, type DeleteFolderResponse, type Folder } from '../core/ayarlar';
import type { SettingsStore } from './ayar-deposu';
import { json, methodNotAllowed, notFound, readJson } from './http';

const COLLECTION = '/api/klasorler';

/** `/api/klasorler` uçları (tek düzey klasörler). İsteği ele aldıysa `true` döner. */
export function createFolderRoutes({ store }: { store: SettingsStore }) {
  async function create(req: IncomingMessage, res: ServerResponse) {
    const raw = await readJson(req);
    const outcome = await store.update((settings) => {
      const parsed = parseFolderName(raw, settings.folders);
      if (!parsed.ok) return { status: 400, body: { hata: parsed.error } };
      const folder: Folder = { id: randomUUID(), name: parsed.name };
      settings.folders.push(folder);
      return { status: 201, body: folder };
    });
    json(res, outcome.status, outcome.body);
  }

  async function rename(req: IncomingMessage, res: ServerResponse, id: string) {
    const raw = await readJson(req);
    const outcome = await store.update((settings) => {
      const folder = settings.folders.find((f) => f.id === id);
      if (!folder) return { status: 404, body: { hata: 'Klasör bulunamadı' } };
      const parsed = parseFolderName(raw, settings.folders, id);
      if (!parsed.ok) return { status: 400, body: { hata: parsed.error } };
      folder.name = parsed.name;
      return { status: 200, body: { ...folder } };
    });
    json(res, outcome.status, outcome.body);
  }

  async function remove(res: ServerResponse, id: string) {
    const moved = await store.update((settings) =>
      settings.folders.some((f) => f.id === id) ? deleteFolder(settings, id) : null,
    );
    if (moved === null) return notFound(res, 'Klasör bulunamadı');
    const body: DeleteFolderResponse = { tasinan: moved };
    json(res, 200, body);
  }

  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname === COLLECTION) {
      if (req.method === 'GET') json(res, 200, (await store.read()).folders);
      else if (req.method === 'POST') await create(req, res);
      else methodNotAllowed(res);
      return true;
    }
    const match = /^\/api\/klasorler\/([^/]+)$/.exec(pathname);
    if (!match) return false;
    const id = decodeURIComponent(match[1]!);
    if (req.method === 'PUT') await rename(req, res, id);
    else if (req.method === 'DELETE') await remove(res, id);
    else methodNotAllowed(res);
    return true;
  };
}
