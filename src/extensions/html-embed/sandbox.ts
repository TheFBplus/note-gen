/** 每次显式运行生成一个新文档；编辑器普通事务不应调用此函数或替换 iframe。
 * CSP 约束子资源和接口请求，sandbox 隔离宿主。两者都不构成 CPU 限额或完整网络隔离。
 */
export function buildEmbedDocument(code: string, token: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"
  // 在用户源码之前建立策略和错误监听；错误只能显示为文本，不能触发宿主操作。
  const bridge = `(() => {
    const send = (type, message) => parent.postMessage({ type, token: ${JSON.stringify(token)}, message: String(message || '').slice(0, 1000) }, '*');
    addEventListener('error', e => send('html-embed:error', e.message));
    addEventListener('unhandledrejection', e => send('html-embed:error', e.reason));
    addEventListener('DOMContentLoaded', () => send('html-embed:ready'));
    document.addEventListener('click', e => { if (e.target instanceof Element && e.target.closest('a')) e.preventDefault(); }, true);
    document.addEventListener('submit', e => e.preventDefault(), true);
  })();`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><script>${bridge}</script></head><body>${code}</body></html>`
}
