import { spawn } from 'node:child_process';

/** URL'i varsayılan tarayıcıda açar; başarısız olursa sessizce geçer (URL terminalde de yazılıdır). */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Tarayıcı açılamadı; kullanıcı terminaldeki URL'i kullanır.
  }
}
