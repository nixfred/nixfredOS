export type Privacy = 'private' | 'public' | 'never' | 'unknown' | 'none'

export type RemoteRead = {
  verb: 'commit' | 'push'
  remote: string
  url: string
  privacy: Privacy
  label: string
}

declare module 'claude-code' {
  interface PluginState {
    'nixfredos-laws': { failures: number; remote: RemoteRead | null; isHidden: boolean }
  }
}
