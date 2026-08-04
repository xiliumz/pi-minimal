# pi-minimal

Bash-style prompt layout for [pi](https://pi.dev).

```
~/project (main*): |
```

No header. No footer. Session stats live behind `/info`.

## Install

```bash
# from git
pi install git:github.com/xiliumz/pi-minimal

# from a local checkout
pi install /path/to/pi-minimal

# from npm (after you publish)
pi install npm:pi-minimal
```

Restart pi or run `/reload`.

## What you get

| Piece | Behavior |
| --- | --- |
| Prompt | `~/path (branch*):` — dirty tree shows `*` |
| Spinner | Shown in the prompt while the agent runs |
| Header / footer | Removed |
| `/info` | Model, thinking level, context %, tokens, cost, session file/id |

Multiline input and slash-command autocomplete start at column 0 (under the path, not under `:`).
Soft-wrapped continuations use the full terminal width — only the first visual line shares space with the prompt.

## Notes

`/new`, `/resume`, and `/fork` briefly flash the stock pi header/footer/editor.
Pi resets extension UI before the old session context goes stale, then re-runs
`session_start` so this layout comes back. Extension-side fix is not available.

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
src/editor.ts         # bash prompt CustomEditor
src/info.ts           # /info UI + token stats
src/git.ts            # branch + dirty
src/format.ts         # cwd/tokens helpers
src/ui.ts             # empty header/footer component
```

## Uninstall

```bash
pi remove git:github.com/xiliumz/pi-minimal
# or
pi remove npm:pi-minimal
pi remove /path/to/pi-minimal
```

## License

MIT
