import { Store } from '@tauri-apps/plugin-store'

export class InvalidUpdateProxyError extends Error {
  constructor() { super('Invalid custom update proxy URL') }
}

export class UpdateNetworkError extends Error {
  constructor() { super('Custom update network request failed') }
}

/** 与常规设置共用存储约定。系统模式不传手动地址，让新建的原生客户端发现系统代理。 */
export async function resolveUpdateProxy(): Promise<string | undefined> {
  const settings = await Store.load('store.json')
  if (await settings.get<boolean>('systemProxy') === true) return undefined
  const value = (await settings.get<string>('proxy'))?.trim()
  if (!value) return undefined
  try {
    // 常规设置兼容不带协议的 host:port；更新检查与下载必须得到同一个规范化地址。
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`)
    if (!url.hostname || !['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)) throw new Error()
    return url.href
  } catch { throw new InvalidUpdateProxyError() }
}

/** 只识别传输错误，签名/清单/刷盘错误保留原义；网络提示不回显可能包含认证信息的代理地址。 */
export function updateFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof InvalidUpdateProxyError) return { error: error.message, errorKind: 'proxy' as const }
  if (error instanceof UpdateNetworkError || /error sending request|timed?\s*out|timeout|dns|connection|connect error|certificate|tls|network (?:is )?unreachable/i.test(message)) {
    return { error: 'Custom update network request failed', errorKind: 'network' as const }
  }
  return { error: message, errorKind: null }
}
