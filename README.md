# pi-minimal

Bash-style prompt layout for [pi](https://pi.dev).

```
~/project (main*): |
```

No header. No footer. Session stats live behind `/info`.

## Install

```bash
# from a local checkout
pi install ~/pria-random/pi-minimal

# from git (after you push)
pi install git:github.com/dayatani/pi-minimal

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

## Notes

`/new`, `/resume`, and `/fork` briefly flash the stock pi header/footer/editor.
Pi resets extension UI before the old session context goes stale, then re-runs
`session_start` so this layout comes back. Extension-side fix is not available.

## Develop

```bash
git clone <this-repo>
cd pi-minimal

# point pi at the working tree (no copy)
pi install ~/pria-random/pi-minimal

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

## Publish

```bash
# 1. push to GitHub
gh repo create dayatani/pi-minimal --public --source=. --push

# 2a. share via git
pi install git:github.com/dayatani/pi-minimal

# 2b. or publish to npm
npm login
npm publish --access public
pi install npm:pi-minimal
```

Bump `version` in `package.json` before each release.

## Uninstall

```bash
pi remove ~/pria-random/pi-minimal
# or
pi remove npm:pi-minimal
pi remove git:github.com/dayatani/pi-minimal
```

## License

MIT
