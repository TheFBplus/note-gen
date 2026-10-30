// 仅云端定制包启用；普通开发构建继续使用上游更新策略。
export const IS_CUSTOM_BUILD = process.env.NEXT_PUBLIC_NOTEGEN_CUSTOM_BUILD === '1'
export const CUSTOM_RELEASES_URL = 'https://github.com/TheFBplus/note-gen/releases'
