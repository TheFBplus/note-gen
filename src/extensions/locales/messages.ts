import type { AbstractIntlMessages } from 'next-intl'
import en from './en.json'
import zh from './zh.json'

/** 仅补齐扩展命名空间；上游及语言插件已有的值优先，输入对象始终保持不变。 */
export function withExtensionMessages(messages: AbstractIntlMessages, locale: string): AbstractIntlMessages {
  function fill(current: AbstractIntlMessages, fallback: AbstractIntlMessages): AbstractIntlMessages {
    const result = { ...current }
    for (const [key, value] of Object.entries(fallback)) {
      const existing = result[key]
      if (existing === undefined) result[key] = value
      else if (value && typeof value === 'object' && existing && typeof existing === 'object') {
        result[key] = fill(existing, value)
      }
    }
    return result
  }
  return fill(messages, locale === 'zh' ? zh : en)
}
