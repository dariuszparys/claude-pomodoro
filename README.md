# Pomodoro for Claude Code

A Pomodoro timer that sits in a pane beside the chat in Claude Code. It defaults to 25 minutes of focus and a 5 minute break, and both lengths are adjustable and remembered across sessions.

- A progress ring with the time left, and dots for the pomodoros finished in the current round of four (a thin line and ● ○ in the terminal)
- Start / Pause, Skip and Reset buttons, with the hotkeys `s`, `n` and `r` while the pane has focus
- When a focus ends the break starts by itself; when a break ends the timer waits for you to start the next focus
- A toast, a short chime (macOS) and a status line entry such as `🍅 Focus 23:41` while it runs
- **Adjust** opens − / + steppers for the focus (5 minute steps) and break (1 minute steps) lengths, and a sound toggle

<img width="4330" height="3096" alt="CleanShot 2026-10-27 at 07 34 36@2x" src="https://github.com/user-attachments/assets/9d18efd2-16c5-4f73-b713-63877cc88ed7" />


## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pomodoro --marketplace dariuszparys/claude-pomodoro
```

Answer `y` to add the marketplace, then pick a scope (the user scope is first).

From a shell:

```bash
claude plugin install pomodoro --marketplace dariuszparys/claude-pomodoro
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `dariuszparys/claude-pomodoro`, then Add plugin.

## Use

| Command | What it does |
| --- | --- |
| `/pomodoro` | Opens the pane |
| `/pomodoro start` / `pause` / `reset` / `skip` | Drives the timer, even while Claude is replying |
| `/pomodoro 50 10` | Sets 50 minutes of focus and a 10 minute break |

The pane opens by itself at the start of a session where there is room for it beside the chat; otherwise run `/pomodoro`.

## License

MIT, see [LICENSE](LICENSE).
