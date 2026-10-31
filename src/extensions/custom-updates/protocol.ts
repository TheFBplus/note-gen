import { compareVersions } from '@/lib/version'

export const CUSTOM_UPDATE_URL = 'https://raw.githubusercontent.com/TheFBplus/note-gen/refs/heads/codex/custom-update-channel/latest.json'
export interface CustomManifest {
  version: string
  notes: string
  pub_date: string
  release_url: string
  platforms: Record<string, { url: string; signature: string }>
  android: { url: string; version_code: number; sha256: string }
}

export function isCustomVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+-custom\.\d+$/.test(value)
}

export function isCustomDownload(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port
      && url.pathname.startsWith('/TheFBplus/note-gen/releases/download/') && !url.search && !url.hash
  } catch { return false }
}

export function parseCustomManifest(value: unknown): CustomManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid custom update manifest')
  const data = value as Partial<CustomManifest>
  if (!isCustomVersion(data.version) || typeof data.notes !== 'string' || typeof data.pub_date !== 'string'
    || !Number.isFinite(Date.parse(data.pub_date)) || typeof data.release_url !== 'string'
    || !data.release_url.startsWith('https://github.com/TheFBplus/note-gen/releases/tag/')) {
    throw new Error('Invalid custom update metadata')
  }
  for (const target of ['windows-x86_64-nsis', 'darwin-aarch64']) {
    const item = data.platforms?.[target]
    if (!item || !isCustomDownload(item.url) || typeof item.signature !== 'string' || !item.signature.trim()) {
      throw new Error('Incomplete signed custom update: ' + target)
    }
  }
  if (!data.android || !isCustomDownload(data.android.url) || !data.android.url.endsWith('_android-arm64.apk')
    || !Number.isSafeInteger(data.android.version_code) || data.android.version_code <= 1_000_000_000
    || !/^[a-f0-9]{64}$/.test(data.android.sha256)) throw new Error('Invalid Android custom update')
  return data as CustomManifest
}

export function newerCustomVersion(manifest: CustomManifest, current: string) {
  return isCustomVersion(current) && compareVersions(manifest.version, current) > 0
}
