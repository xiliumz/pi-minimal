# pi-minimal

Bash-style prompt layout for [pi](https://pi.dev).

```
~/project (main*):
$ |
```

No header. No footer. Session stats live behind `/info` or `F8`.

## Install

```bash
# from git
pi install git:github.com/xiliumz/pi-minimal

# from a local checkout
pi install /path/to/pi-minimal

# from npm
pi install npm:@xiliumz/pi-minimal
```

Restart pi or run `/reload`.

## What you get

| Piece | Behavior |
| --- | --- |
| Prompt | `~/path (branch*):` above `$ ` input — dirty tree shows `*` |
| Spinner | Shown in the prompt while the agent runs |
| Header / footer | Removed |
| `/info` / `F8` | Model, thinking level, context %, tokens, cost, session file/id |
| Tool rows / `Ctrl+O` | Cycles **grouped** → **title** → **collapsed** → **full**. Starts grouped |

Tool views:

- **grouped** — back-to-back tool calls collapse into one `N tools` line; a lone call shows its name
- **title** — one line per call, tool name only (red when the call failed)
- **collapsed** — pi's default truncated preview
- **full** — pi's normal expanded output

Assistant text, thinking, and user messages end a group.

Multiline input and slash-command autocomplete start at column 0 (under `$ `).
Soft-wrapped continuations use the full terminal width — only the first visual line shares space with `$ `.

## Notes

`/new`, `/resume`, and `/fork` briefly flash the stock pi header/footer/editor.
Pi resets extension UI before the old session context goes stale, then re-runs
`session_start` so this layout comes back. Extension-side fix is not available.

`Ctrl+O` follows your `app.tools.expand` keybinding and shows the new view as
`Tool output: <view>`. `/export` renders tools in
the current view — switch to **full** first for complete HTML.

## Develop

```bash
git clone https://github.com/xiliumz/pi-minimal.git
cd pi-minimal

# point pi at the working tree (no copy)
pi install "$PWD"

# edit → /reload inside pi
```

Layout:

```
extensions/index.ts   # pi entry (registers hooks + commands)
src/editor.ts         # bash prompt CustomEditor (+ Ctrl+O hook)
src/tool-view.ts      # grouped / title / full tool renderers
src/tool-runs.ts      # tracks back-to-back tool calls
src/info.ts           # /info UI + token stats
src/git.ts            # branch + dirty
src/format.ts         # cwd/tokens helpers
src/ui.ts             # empty header/footer component
```

## Uninstall

```bash
pi remove git:github.com/xiliumz/pi-minimal
# or
pi remove npm:@xiliumz/pi-minimal
pi remove /path/to/pi-minimal
```

## License

MIT
