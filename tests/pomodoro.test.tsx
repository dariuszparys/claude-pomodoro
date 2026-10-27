import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MINUTE = 60_000
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

const PANE = {
  plugin: 'pomodoro',
  component: 'Pane',
  requestId: 'pomodoro',
  props: {
    title: 'Pomodoro',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

type Drawing = { find: (query: { type?: string; key?: string; text?: RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined> }

// The dial: an Svg's alt where the surface draws SVG, the Texts on the terminal.
async function dial(ui: Drawing): Promise<string> {
  const svg = await ui.find({ type: 'Svg' })
  if (svg !== undefined) return String(svg.props.alt)
  const texts = await Promise.all([/^\d{2,3}:\d{2}$/, /Focus|Break|Ready/].map(text => ui.find({ type: 'Text', text })))

  return texts.map(t => t?.text ?? '').join(' | ')
}

// Nothing sits beneath the plugin: these hooks stand for the engine.
function engine(on: On, store: Record<string, unknown> = {}) {
  const toasts: string[] = []
  const sounds: unknown[] = []
  const status: (string | undefined)[] = []

  on('command.register', () => ({ value: { command: 'pomodoro' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('audio.play', (_, e) => {
    sounds.push(e.clip)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: 1_000_000 })

  return { clock, toasts, sounds, status, store }
}

test('defaults to a 25 minute focus and a 5 minute break, on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await dial(ui)).toMatch(/25:00/)
    expect(await dial(ui)).toMatch(/Ready to focus/)
    expect(await ui.find({ type: 'Text', text: /25 min focus · 5 min break · 0 done/ })).toBeDefined()
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    await ui.unmount()
  }
})

// The ticker fires each second, so the timed tests use short lengths.
const SHORT = { settings: { focusMinutes: 2, breakMinutes: 1, isSoundOn: true } }

test('a focus runs down, then the break starts by itself and ends ready for the next focus', async ($, on) => {
  const world = engine(on, { ...SHORT })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'toggle' })
  await world.clock.advance(MINUTE + 1000)
  expect(await dial(ui)).toMatch(/^Focus, 00:59 left/)
  expect(world.status.at(-1)).toBe('🍅 Focus 00:59')

  await world.clock.advance(59_000)
  expect(await dial(ui)).toBe('Break, 01:00 left, 1 of 4 in this round')
  expect(await ui.find({ type: 'Text', text: /· 1 done/ })).toBeDefined()
  expect(world.toasts.at(-1)).toBe('Focus done. Take a 1 minute break.')
  expect(world.sounds).toHaveLength(1)

  await world.clock.advance(MINUTE)
  expect(await dial(ui)).toMatch(/^Ready to focus, 02:00 left/)
  expect(world.toasts.at(-1)).toBe('Break over. Start the next 2 minute focus when ready.')
  expect(world.sounds).toHaveLength(2)
  expect(world.status.at(-1)).toBeUndefined()
  await ui.unmount()
})

test('pause holds the time and resume carries on from it', async ($, on) => {
  const world = engine(on, { ...SHORT })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'toggle' })
  await world.clock.advance(30_000)
  await ui.press({ key: 'toggle' })
  await world.clock.advance(10 * MINUTE)
  expect(await dial(ui)).toBe('01:30 | 🍅 Focus · paused')
  expect(world.status.at(-1)).toBe('🍅 Focus 01:30 (paused)')

  await ui.press({ key: 'toggle' })
  await world.clock.advance(30_000)
  expect(await dial(ui)).toBe('01:00 | 🍅 Focus')
  await ui.unmount()
})

test('the plus and minus buttons change the lengths and keep them for the next session', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ key: 'focus-more' })).toBeUndefined()
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'focus-more' })
  await ui.press({ key: 'break-less' })
  expect(await dial(ui)).toMatch(/30:00/)
  expect(await ui.find({ type: 'Text', text: /^4 min$/ })).toBeDefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ key: 'focus-more' })).toBeUndefined()
  expect(world.store.settings).toEqual({ focusMinutes: 30, breakMinutes: 4, isSoundOn: true })
  await ui.unmount()
})

test('with the sound off a phase ends silently', async ($, on) => {
  const world = engine(on, { ...SHORT })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'settings' })
  await ui.press({ key: 'sound' })
  expect((await ui.find({ key: 'sound' }))?.text).toBe('Sound off')
  await ui.press({ key: 'toggle' })
  await world.clock.advance(2 * MINUTE)
  expect(world.toasts.at(-1)).toBe('Focus done. Take a 1 minute break.')
  expect(world.sounds).toHaveLength(0)
  await ui.unmount()
})

test('stored lengths are read back at session start', async ($, on) => {
  engine(on, { settings: { focusMinutes: 45, breakMinutes: 15, isSoundOn: true } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await dial(ui)).toMatch(/45:00/)
  expect(await ui.find({ type: 'Text', text: /45 min focus · 15 min break/ })).toBeDefined()
  await ui.unmount()
})

test('/pomodoro sets the lengths and drives the timer', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const set = await $.command.run({ ...TYPED, command: 'pomodoro', args: '50 10' })
  expect(set.text).toBe('Pomodoro ready: Focus 50:00 (50 min focus / 10 min break).')

  const started = await $.command.run({ ...TYPED, command: 'pomodoro', args: 'start' })
  expect(started.text).toBe('Pomodoro running: Focus 50:00 left (50 min focus / 10 min break).')

  const skipped = await $.command.run({ ...TYPED, command: 'pomodoro', args: 'skip' })
  expect(skipped.text).toBe('Pomodoro ready: Break 10:00 (50 min focus / 10 min break).')

  const bad = await $.command.run({ ...TYPED, command: 'pomodoro', args: 'later' })
  expect(bad.text).toMatch(/^Usage:/)
})
