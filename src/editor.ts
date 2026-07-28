import {
	CustomEditor,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatCwd, isBorderOrScrollLine } from "./format.js";
import type { GitState } from "./git.js";

export interface BashPromptState {
	git: GitState;
	isWorking: boolean;
	spinnerFrame: string;
	/** Called when the editor mounts so the extension can request re-renders. */
	onMount: (tui: TUI) => void;
}

/**
 * Borderless editor that prefixes the first input line with a bash-style prompt:
 *   ~/path (branch*): |
 *
 * Continuation lines start at column 0 (under the start of the prompt).
 * Slash/path autocomplete also renders at column 0, full width.
 */
export function createBashPromptEditor(
	ctx: ExtensionContext,
	state: BashPromptState,
): new (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => CustomEditor {
	return class BashPromptEditor extends CustomEditor {
		constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
			super(tui, theme, keybindings, { paddingX: 0 });
			state.onMount(tui);
		}

		/** Host may push settings padding — keep 0 so prompt math stays correct. */
		override setPaddingX(_paddingX: number): void {
			super.setPaddingX(0);
		}

		private promptString(): string {
			const thm = ctx.ui.theme as Theme;
			const cwd = formatCwd(ctx.cwd);
			const branch = state.git.branch
				? thm.fg("muted", ` (${state.git.branch}${state.git.dirty ? "*" : ""})`)
				: "";
			const path = thm.fg("success", cwd);
			const working = state.isWorking
				? thm.fg("accent", `${state.spinnerFrame} `)
				: "";
			return `${working}${path}${branch}${thm.fg("dim", ":")}`;
		}

		render(width: number): string[] {
			const prompt = this.promptString();
			const promptW = visibleWidth(prompt);
			// First line shares the row with the prompt; wrap all content to that width
			// so soft-wrap breaks match the visible first line. Continuations sit at col 0.
			const innerWidth = Math.max(8, width - promptW);

			const raw = super.render(innerWidth);
			if (raw.length === 0) {
				return [truncateToWidth(prompt, width)];
			}

			// raw: [topBorder, ...content, bottomBorder, ...autocomplete?]
			const withoutTop = raw.slice(1);
			if (withoutTop.length === 0) {
				return [truncateToWidth(prompt, width)];
			}

			let borderIdx = -1;
			for (let i = withoutTop.length - 1; i >= 0; i--) {
				if (isBorderOrScrollLine(withoutTop[i]!)) {
					borderIdx = i;
					break;
				}
			}

			const content = borderIdx >= 0 ? withoutTop.slice(0, borderIdx) : withoutTop;
			const out: string[] = [];

			if (content.length === 0) {
				out.push(truncateToWidth(prompt, width));
			} else {
				for (let i = 0; i < content.length; i++) {
					const line = content[i]!;
					if (i === 0) {
						out.push(truncateToWidth(prompt + line, width));
					} else {
						// Column 0 — under the start of the prompt, not under `:`.
						out.push(truncateToWidth(line, width));
					}
				}
			}

			// Autocomplete at column 0, full terminal width.
			const acList = (
				this as unknown as { autocompleteList?: { render: (w: number) => string[] } }
			).autocompleteList;
			if (this.isShowingAutocomplete() && acList) {
				for (const line of acList.render(width)) {
					out.push(truncateToWidth(line, width));
				}
			}

			return out;
		}
	};
}
