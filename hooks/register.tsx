import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { PomodoroTimer, PomodoroPhase, PomodoroSettings } from '../types'

const PANE = 'pomodoro'
const TITLE = 'Pomodoro'
const MINUTE = 60_000
const CHIME = 'sounds/chime.wav'

const DEFAULTS: PomodoroSettings = { focusMinutes: 25, breakMinutes: 5, isSoundOn: true }
const LIMITS: Record<PomodoroPhase, { min: number; max: number; step: number }> = {
  focus: { min: 1, max: 180, step: 5 },
  break: { min: 1, max: 60, step: 1 },
}
const LABEL: Record<PomodoroPhase, string> = { focus: 'Focus', break: 'Break' }
const ICON: Record<PomodoroPhase, string> = { focus: '🍅', break: '☕' }
const ACCENT: Record<PomodoroPhase, string> = { focus: '#E8604C', break: '#3FAE7A' }
// Pomodoros per round, shown as dots under the time.
const CYCLE = 4

const settings = atom({ plugin: 'pomodoro', key: 'settings' } as const, DEFAULTS)
const timer = atom({ plugin: 'pomodoro', key: 'timer' } as const, ready('focus', DEFAULTS, 0))
const isSettingsOpen = atom({ plugin: 'pomodoro', key: 'isSettingsOpen' } as const, false)

// Timers die with the module on a hot reload; session.start restarts this one.
let ticker: Timer | undefined

function minutesOf(phase: PomodoroPhase, s: PomodoroSettings): number {
  return phase === 'focus' ? s.focusMinutes : s.breakMinutes
}

function ready(phase: PomodoroPhase, s: PomodoroSettings, completed: number): PomodoroTimer {
  const totalMs = minutesOf(phase, s) * MINUTE

  return { phase, status: 'idle', endsAt: null, remainingMs: totalMs, totalMs, completed }
}

function running(phase: PomodoroPhase, s: PomodoroSettings, completed: number, now: number): PomodoroTimer {
  const idle = ready(phase, s, completed)

  return { ...idle, status: 'running', endsAt: now + idle.totalMs }
}

function clampMinutes(phase: PomodoroPhase, value: number): number {
  const { min, max } = LIMITS[phase]

  return Math.min(max, Math.max(min, Math.round(value)))
}

// Pure, since `update` may run it again on a version miss.
function tickAt(c: PomodoroTimer, now: number, s: PomodoroSettings): PomodoroTimer {
  if (c.status !== 'running' || c.endsAt === null) return c
  if (now < c.endsAt) return { ...c, remainingMs: c.endsAt - now }
  if (c.phase === 'focus') return running('break', s, c.completed + 1, now)

  return ready('focus', s, c.completed)
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return `${mm}:${ss}`
}

function progress(c: PomodoroTimer): number {
  const done = c.totalMs === 0 ? 1 : 1 - c.remainingMs / c.totalMs

  return Math.min(1, Math.max(0, done))
}

function caption(c: PomodoroTimer): string {
  if (c.status === 'running') return LABEL[c.phase]
  if (c.status === 'paused') return `${LABEL[c.phase]} · paused`

  return c.phase === 'focus' ? 'Ready to focus' : 'Break next'
}

// The progress ring for surfaces that draw SVG. Text colours follow the
// system theme, since an SVG image cannot read the app's theme keys.
function ring(c: PomodoroTimer): string {
  const size = 220
  const mid = size / 2
  const radius = 92
  const stroke = 10
  const length = 2 * Math.PI * radius
  const done = progress(c)
  const accent = ACCENT[c.phase]
  const round = c.completed % CYCLE
  const dots = Array.from({ length: CYCLE }, (_, i) => {
    const x = mid + (i - (CYCLE - 1) / 2) * 14
    const fill = i < round ? accent : 'rgba(128,128,128,0.35)'

    return `<circle cx="${x}" cy="${mid + 46}" r="3.5" fill="${fill}"/>`
  }).join('')
  const arc =
    done === 0
      ? ''
      : `<circle cx="${mid}" cy="${mid}" r="${radius}" fill="none" stroke="${accent}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${length.toFixed(2)}" stroke-dashoffset="${(length * (1 - done)).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    '<style>',
    '.time{fill:#1d1d1f;font:600 48px -apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-0.5px}',
    '.cap{fill:#6e6e73;font:500 13px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;letter-spacing:0.4px}',
    '@media (prefers-color-scheme:dark){.time{fill:#f5f5f7}.cap{fill:#a1a1a6}}',
    '</style>',
    `<circle cx="${mid}" cy="${mid}" r="${radius}" fill="none" stroke="rgba(128,128,128,0.18)" stroke-width="${stroke}"/>`,
    arc,
    `<text x="${mid}" y="${mid - 30}" text-anchor="middle" class="cap">${caption(c)}</text>`,
    `<text x="${mid}" y="${mid + 17}" text-anchor="middle" class="time">${clock(c.remainingMs)}</text>`,
    dots,
    '</svg>',
  ].join('')
}

// The terminal has no SVG: a thin line of box-drawing characters instead.
function line(c: PomodoroTimer, width: number): string {
  const filled = Math.round(progress(c) * width)

  return '━'.repeat(filled) + '─'.repeat(width - filled)
}

function statusText(c: PomodoroTimer): string | undefined {
  if (c.status === 'idle') return undefined
  const paused = c.status === 'paused' ? ' (paused)' : ''

  return `${ICON[c.phase]} ${LABEL[c.phase]} ${clock(c.remainingMs)}${paused}`
}

function describe(c: PomodoroTimer, s: PomodoroSettings): string {
  const length = `${s.focusMinutes} min focus / ${s.breakMinutes} min break`
  if (c.status === 'idle') return `Pomodoro ready: ${LABEL[c.phase]} ${clock(c.remainingMs)} (${length}).`

  return `Pomodoro ${c.status}: ${LABEL[c.phase]} ${clock(c.remainingMs)} left (${length}).`
}

function parseSettings(value: unknown): PomodoroSettings {
  if (typeof value !== 'object' || value === null) return DEFAULTS
  const v = value as Partial<Record<keyof PomodoroSettings, unknown>>

  return {
    focusMinutes:
      typeof v.focusMinutes === 'number' ? clampMinutes('focus', v.focusMinutes) : DEFAULTS.focusMinutes,
    breakMinutes:
      typeof v.breakMinutes === 'number' ? clampMinutes('break', v.breakMinutes) : DEFAULTS.breakMinutes,
    isSoundOn: typeof v.isSoundOn === 'boolean' ? v.isSoundOn : DEFAULTS.isSoundOn,
  }
}

function stopTicker(): void {
  ticker?.cancel()
  ticker = undefined
}

function startTicker($: EngineInterface): void {
  stopTicker()
  ticker = $.clock.every(1000, () => {
    void tick($).catch(err => $.ui.log(`pomodoro: tick failed: ${String(err)}`))
  })
}

function chime($: EngineInterface, s: PomodoroSettings): void {
  if (!s.isSoundOn) return
  void $.audio.play({ asset: CHIME }).catch(() => undefined)
}

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const s = await read($, settings)
  const before = await read($, timer)
  const after = await update($, timer, c => tickAt(c, now, s))

  $.ui.status(statusText(after))
  if (after.status !== 'running') stopTicker()
  if (after.phase === before.phase) return

  chime($, s)
  const message =
    after.phase === 'break'
      ? `Focus done. Take a ${s.breakMinutes} minute break.`
      : `Break over. Start the next ${s.focusMinutes} minute focus when ready.`
  $.ui.toast(message, { timeoutMs: 10_000 })
}

async function start($: EngineInterface): Promise<PomodoroTimer> {
  const now = await $.clock.now()
  const after = await update($, timer, (c): PomodoroTimer =>
    c.status === 'running' ? c : { ...c, status: 'running', endsAt: now + c.remainingMs },
  )
  startTicker($)
  $.ui.status(statusText(after))

  return after
}

async function pause($: EngineInterface): Promise<PomodoroTimer> {
  const now = await $.clock.now()
  stopTicker()
  const after = await update($, timer, (c): PomodoroTimer =>
    c.status !== 'running' || c.endsAt === null
      ? c
      : { ...c, status: 'paused', endsAt: null, remainingMs: Math.max(0, c.endsAt - now) },
  )
  $.ui.status(statusText(after))

  return after
}

async function reset($: EngineInterface): Promise<PomodoroTimer> {
  stopTicker()
  const s = await read($, settings)
  const after = await update($, timer, c => ready('focus', s, c.completed))
  $.ui.status(undefined)

  return after
}

// Moves to the next phase, ready to start; a skipped focus does not count.
async function skip($: EngineInterface): Promise<PomodoroTimer> {
  stopTicker()
  const s = await read($, settings)
  const after = await update($, timer, c => ready(c.phase === 'focus' ? 'break' : 'focus', s, c.completed))
  $.ui.status(undefined)

  return after
}

async function changeSettings($: EngineInterface, change: (s: PomodoroSettings) => PomodoroSettings): Promise<PomodoroSettings> {
  const s = await update($, settings, change)
  await $.store.set('settings', s)
  // An idle timer shows the new length at once; a started one keeps its own.
  await update($, timer, c => (c.status === 'idle' ? ready(c.phase, s, c.completed) : c))

  return s
}

function nudge($: EngineInterface, phase: PomodoroPhase, direction: 1 | -1): Promise<PomodoroSettings> {
  const key = phase === 'focus' ? 'focusMinutes' : 'breakMinutes'
  const step = LIMITS[phase].step

  return changeSettings($, s => {
    // Snap to the step grid, so 22 goes to 25 or 20 rather than 27 or 17.
    const next = direction > 0 ? Math.floor(s[key] / step) * step + step : Math.ceil(s[key] / step) * step - step

    return { ...s, [key]: clampMinutes(phase, next) }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const s = parseSettings(await $.store.get('settings'))
    await update($, settings, () => s)
    const c = await update($, timer, c => (c.status === 'idle' ? ready(c.phase, s, c.completed) : c))
    if (c.status === 'running') startTicker($)
    $.ui.status(statusText(c))

    await $.command.register({
      name: 'pomodoro',
      description: 'Open the Pomodoro timer, or start, pause, reset, skip it, or set its minutes',
      argumentHint: '[start|pause|reset|skip] | [focus-min] [break-min]',
      immediate: true,
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'pomodoro' }, async ($, e) => {
    const args = e.args.trim().toLowerCase()
    const s = await read($, settings)

    if (args === '' || args === 'open') {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      const c = await read($, timer)

      return { text: opened.isPlaced ? describe(c, s) : `Pomodoro pane is waiting for room: ${opened.reason}` }
    }
    if (args === 'start' || args === 'resume') return { text: describe(await start($), s) }
    if (args === 'pause' || args === 'stop') return { text: describe(await pause($), s) }
    if (args === 'reset') return { text: describe(await reset($), s) }
    if (args === 'skip') return { text: describe(await skip($), s) }

    const numbers = args.split(/[\s/,]+/).map(Number)
    const [focus, rest] = numbers
    const isValid =
      numbers.length <= 2 &&
      focus !== undefined &&
      Number.isFinite(focus) &&
      (rest === undefined || Number.isFinite(rest))
    if (!isValid) {
      return {
        text: 'Usage: /pomodoro [start|pause|reset|skip], or /pomodoro <focus-min> [break-min], e.g. /pomodoro 50 10',
      }
    }

    const changed = await changeSettings($, current => ({
      ...current,
      focusMinutes: clampMinutes('focus', focus),
      breakMinutes: rest === undefined ? current.breakMinutes : clampMinutes('break', rest),
    }))

    return { text: describe(await read($, timer), changed) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await read($, timer)
    const s = await read($, settings)
    const isOpen = await read($, isSettingsOpen)
    const toggle = c.status === 'running' ? 'Pause' : c.status === 'paused' ? 'Resume' : 'Start'
    const round = c.completed % CYCLE

    const alt = `${caption(c)}, ${clock(c.remainingMs)} left, ${round} of ${CYCLE} in this round`
    let dial
    if (e.surface === 'terminal') {
      const color = c.phase === 'focus' ? 'error' : 'success'
      dial = (
        <Box flexDirection="column" alignItems="center">
          <Text color={color}>
            {ICON[c.phase]} {caption(c)}
          </Text>
          <Text bold>{clock(c.remainingMs)}</Text>
          <Text color={color}>{line(c, Math.max(10, Math.min(28, e.props.bodyColumns - 4)))}</Text>
          <Text dimColor>{'●'.repeat(round) + '○'.repeat(CYCLE - round)}</Text>
        </Box>
      )
    } else {
      const { Svg } = $.ui.resolve(e)
      dial = <Svg source={ring(c)} alt={alt} width={220} height={220} />
    }

    return (
      <Box flexDirection="column" alignItems="center" gap={1} paddingY={1}>
        {dial}
        <Box flexDirection="row" gap={1} justifyContent="center">
          <Button
            key="toggle"
            label={toggle}
            hotkey="s"
            variant="primary"
            onPress={() => void (c.status === 'running' ? pause($) : start($))}
          />
          <Button key="skip" label="Skip" hotkey="n" onPress={() => void skip($)} />
          <Button key="reset" label="Reset" hotkey="r" onPress={() => void reset($)} />
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center" justifyContent="center">
          <Text dimColor>
            {s.focusMinutes} min focus · {s.breakMinutes} min break · {c.completed} done
          </Text>
          <Button
            key="settings"
            label={isOpen ? 'Done' : 'Adjust'}
            plain
            dimColor
            onPress={() => void update($, isSettingsOpen, open => !open)}
          />
        </Box>
        {isOpen && (
          <Box flexDirection="column" gap={1} alignItems="center">
            {(['focus', 'break'] as const).map(phase => (
              <Box flexDirection="row" gap={1} alignItems="center">
                <Box width={6}>
                  <Text>{LABEL[phase]}</Text>
                </Box>
                <Button key={`${phase}-less`} label="−" onPress={() => void nudge($, phase, -1)} />
                <Box width={8} justifyContent="center">
                  <Text tabular>{minutesOf(phase, s)} min</Text>
                </Box>
                <Button key={`${phase}-more`} label="+" onPress={() => void nudge($, phase, 1)} />
              </Box>
            ))}
            <Button
              key="sound"
              label={s.isSoundOn ? 'Sound on' : 'Sound off'}
              plain
              dimColor={!s.isSoundOn}
              onPress={() => void changeSettings($, current => ({ ...current, isSoundOn: !current.isSoundOn }))}
            />
          </Box>
        )}
      </Box>
    )
  })
}
