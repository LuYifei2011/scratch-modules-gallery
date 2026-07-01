const DEV_CLIENT_SCRIPT = '<script src="/__dev/client.js"></script>';
const DEV_CLIENT_INJECT = `\n${DEV_CLIENT_SCRIPT}\n`;

export function shouldInjectDevClient(pathname?: string) {
  if (!pathname) return true;
  return !pathname.includes('__dev/editor');
}

export function injectDevClient(html: string, pathname?: string) {
  if (!shouldInjectDevClient(pathname)) return html;
  if (html.includes('/__dev/client.js')) return html;
  if (html.includes('</body>')) return html.replace('</body>', `${DEV_CLIENT_INJECT}</body>`);
  return html + DEV_CLIENT_INJECT;
}
