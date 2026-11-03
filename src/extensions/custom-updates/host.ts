import { useCustomUpdates } from './store'

export interface CustomUpdateHostState {
  update: null
  hasUpdate: boolean
  latestVersion: string
  ignoredVersion: string
  mobileUpdate: { version: string; notes: string; pubDate: string } | null
  mobileUpdateStatus: 'idle' | 'checking' | 'ready' | 'error'
  mobileUpdateError: string
}

/** 宿主只接收兼容字段；定制界面不再反向写宿主 store，且不暴露原生更新对象。 */
export function connectCustomUpdateHost(set: (state: CustomUpdateHostState) => void) {
  const synchronize = () => {
    const current = useCustomUpdates.getState()
    const manifest = current.hasUpdate && current.mobile ? current.manifest : null
    set({
      update: null,
      hasUpdate: current.hasUpdate,
      latestVersion: current.manifest?.version || '',
      ignoredVersion: current.ignored,
      mobileUpdate: manifest ? { version: manifest.version, notes: manifest.notes, pubDate: manifest.pub_date } : null,
      mobileUpdateStatus: current.status === 'idle' || current.status === 'checking' || current.status === 'error' ? current.status : 'ready',
      mobileUpdateError: current.error,
    })
  }
  const unsubscribe = useCustomUpdates.subscribe(synchronize)
  synchronize()
  return unsubscribe
}

export async function checkCustomUpdates() {
  await useCustomUpdates.getState().check()
}
