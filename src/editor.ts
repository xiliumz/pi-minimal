import {
	CustomEditor,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	formatCwd,
	isBorderOrScrollLine,
	wordWrapLineVariable,
	type GraphemeSeg,
	type WrapChunk,
} from "./format.js";
import type { GitState } from "./git.js";

export interface BashPromptState {
	git: GitState;
	isWorking: boolean;
	spinnerFrame: string;
	/** Called when the editor mounts so the extension can request re-renders. */
	onMount: (tui: TUI) => void;
}

/** Subset of Editor internals used for dual-width soft-wrap. */
interface EditorInternals {
	state: { lines: string[]; cursorLine: number; cursorCol: number };
	scrollOffset: number;
	segment(text: string, mode: "word" | "grapheme"): Iterable<{ segment: string; index: number }>;
}

interface LayoutLine {
	text: string;
	hasCursor: boolean;
	cursorPos?: number;
}

/**
 * Borderless editor that prefixes the first input line with a bash-style prompt:
 *   ~/path (branch*): |
 *
 * Soft-wrap: first visual line shares the row with the prompt; every continuation
 * line uses the full terminal width at column 0.
 * Slash/path autocomplete also renders at column 0, full width.
 */
export function createBashPromptEditor(
	ctx: ExtensionContext,
	state: BashPromptState,
): new (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => CustomEditor {
	return class BashPromptEditor extends CustomEditor {
		/** Columns reserved on the first visual line for the bash prompt. */
		private promptInset = 0;

		constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
			super(tui, theme, keybindings, { paddingX: 0 });
			// pi-tui's Editor declares `private layoutText`; TS forbids a subclass
			// member with that name (TS2415/TS2322), but JS ignores `private` at
			// runtime — so install the override as an instance property instead.
			(this as unknown as { layoutText: (contentWidth: number) => LayoutLine[] })
				.layoutText = (contentWidth) => this.layoutWithInset(contentWidth);
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

		private internals(): EditorInternals {
			return this as unknown as EditorInternals;
		}

		/**
		 * Same shape as Editor.layoutText, but the first logical line's first chunk
		 * is narrowed by `promptInset` so the prompt fits on that row. Soft-wrap
		 * continuations (and later hard lines) use the full `contentWidth`.
		 * Installed as the runtime `layoutText` override in the constructor.
		 */
		layoutWithInset(contentWidth: number): LayoutLine[] {
			// Keep method calls on `ed` so `segment` retains Editor as `this`
			// (it calls `this.validPasteIds()` internally).
			const ed = this.internals();
			const layoutLines: LayoutLine[] = [];
			const inset = Math.max(0, this.promptInset);
			const firstWidth = Math.max(1, contentWidth - inset);

			if (ed.state.lines.length === 0 || (ed.state.lines.length === 1 && ed.state.lines[0] === "")) {
				layoutLines.push({ text: "", hasCursor: true, cursorPos: 0 });
				return layoutLines;
			}

			for (let i = 0; i < ed.state.lines.length; i++) {
				const line = ed.state.lines[i] || "";
				const isCurrentLine = i === ed.state.cursorLine;
				const lineVisibleWidth = visibleWidth(line);
				// Only the very first logical line pays the prompt tax, and only on
				// its first visual chunk. Hard-newline lines are full width.
				const useInset = i === 0 && inset > 0;
				const fitsSingle =
					lineVisibleWidth <= (useInset ? firstWidth : contentWidth);

				if (fitsSingle) {
					if (isCurrentLine) {
						layoutLines.push({
							text: line,
							hasCursor: true,
							cursorPos: ed.state.cursorCol,
						});
					} else {
						layoutLines.push({ text: line, hasCursor: false });
					}
					continue;
				}

				const graphemes: GraphemeSeg[] = [...ed.segment(line, "grapheme")].map((s) => ({
					segment: s.segment,
					index: s.index,
				}));
				const chunks: WrapChunk[] = useInset
					? wordWrapLineVariable(line, firstWidth, contentWidth, graphemes)
					: wordWrapLineVariable(line, contentWidth, contentWidth, graphemes);

				for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
					const chunk = chunks[chunkIndex]!;
					const isLastChunk = chunkIndex === chunks.length - 1;
					let hasCursorInChunk = false;
					let adjustedCursorPos = 0;

					if (isCurrentLine) {
						const cursorPos = ed.state.cursorCol;
						if (isLastChunk) {
							hasCursorInChunk = cursorPos >= chunk.startIndex;
							adjustedCursorPos = cursorPos - chunk.startIndex;
						} else {
							hasCursorInChunk =
								cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex;
							if (hasCursorInChunk) {
								adjustedCursorPos = cursorPos - chunk.startIndex;
								if (adjustedCursorPos > chunk.text.length) {
									adjustedCursorPos = chunk.text.length;
								}
							}
						}
					}

					if (hasCursorInChunk) {
						layoutLines.push({
							text: chunk.text,
							hasCursor: true,
							cursorPos: adjustedCursorPos,
						});
					} else {
						layoutLines.push({ text: chunk.text, hasCursor: false });
					}
				}
			}

			return layoutLines;
		}

		render(width: number): string[] {
			const prompt = this.promptString();
			const promptW = visibleWidth(prompt);
			this.promptInset = promptW;

			// Full terminal width — layoutText narrows only the first visual chunk.
			const raw = super.render(width);
			this.promptInset = 0;

			if (raw.length === 0) {
				return [truncateToWidth(prompt, width, "")];
			}

			// raw: [topBorder, ...content, bottomBorder, ...autocomplete?]
			const withoutTop = raw.slice(1);
			if (withoutTop.length === 0) {
				return [truncateToWidth(prompt, width, "")];
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
			const scrolled = this.internals().scrollOffset > 0;
			// First content row is padded to full width by Editor; keep only the
			// budget to the right of the prompt, then splice the prompt in.
			const firstBudget = Math.max(1, width - promptW);

			if (content.length === 0) {
				out.push(truncateToWidth(prompt, width, ""));
			} else {
				for (let i = 0; i < content.length; i++) {
					const line = content[i]!;
					if (i === 0 && !scrolled) {
						const body = truncateToWidth(line, firstBudget, "");
						out.push(truncateToWidth(prompt + body, width, ""));
					} else {
						// Column 0 — full width under the start of the prompt.
						out.push(truncateToWidth(line, width, ""));
					}
				}
			}

			// Autocomplete at column 0, full terminal width.
			const acList = (
				this as unknown as { autocompleteList?: { render: (w: number) => string[] } }
			).autocompleteList;
			if (this.isShowingAutocomplete() && acList) {
				for (const line of acList.render(width)) {
					out.push(truncateToWidth(line, width, ""));
				}
			}

			return out;
		}
	};
}
