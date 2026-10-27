export type PomodoroPhase = 'focus' | 'break'

export type PomodoroTimer = {
  phase: PomodoroPhase
  status: 'idle' | 'running' | 'paused'
  /** Epoch ms the phase ends at while running; null while idle or paused. */
  endsAt: number | null
  remainingMs: number
  totalMs: number
  /** Focus sessions finished in this session. */
  completed: number
}

export type PomodoroSettings = {
  focusMinutes: number
  breakMinutes: number
  isSoundOn: boolean
}

declare module 'claude-code' {
  interface PluginState {
    pomodoro: { timer: PomodoroTimer; settings: PomodoroSettings; isSettingsOpen: boolean }
  }
}
