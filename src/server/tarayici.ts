import { spawn } from 'node:child_process';

/** URL'i varsayılan tarayıcıda açar; başarısız olursa sessizce geçer (URL terminalde de yazılıdır). */
export function openBrowser(url: string): void {
  launch(
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]],
  );
}

/** Dizini işletim sisteminin dosya yöneticisinde (Finder, Explorer) açar; başarısız olursa sessizce geçer. */
export function openFolder(dir: string): void {
  launch(process.platform === 'win32' ? ['explorer.exe', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]]);
}

function launch([command, args]: [string, string[]]): void {
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Açılamadı; kullanıcıya zarar yok.
  }
}
