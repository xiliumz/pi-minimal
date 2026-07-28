/**
 * pi-minimal
 *
 * Bash-style prompt for pi:
 *   ~/path (branch*): |
 *
 * Header/footer chrome removed. Session stats via /info.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { createBashPromptEditor } from "../src/editor.js";
import { fetchGitState, type GitState } from "../src/git.js";
import { showInfoUi } from "../src/info.js";
import { EmptyComponent } from "../src/ui.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function bashLayoutExtension(pi: ExtensionAPI): void {
	let activeTui: TUI | undefined;
	let git: GitState = { dirty: false };
	let isWorking = false;
	let spinnerIndex = 0;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;

	const stopSpinner = () => {
		if (spinnerTimer) {
			clearInterval(spinnerTimer);
			spinnerTimer = undefined;
		}
	};

	const refreshGit = async (cwd: string) => {
		git = await fetchGitState(pi, cwd);
		activeTui?.requestRender();
	};

	const promptState = {
		get git() {
			return git;
		},
		get isWorking() {
			return isWorking;
		},
		get spinnerFrame() {
			return SPINNER_FRAMES[spinnerIndex]!;
		},
		onMount(tui: TUI) {
			activeTui = tui;
		},
	};

	pi.on("agent_start", () => {
		isWorking = true;
		stopSpinner();
		spinnerTimer = setInterval(() => {
			spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
			activeTui?.requestRender();
		}, 80);
		activeTui?.requestRender();
	});

	pi.on("agent_end", (_event, ctx) => {
		isWorking = false;
		stopSpinner();
		if (ctx.mode === "tui") {
			void refreshGit(ctx.cwd);
		}
		activeTui?.requestRender();
	});

	pi.on("session_shutdown", () => {
		stopSpinner();
		activeTui = undefined;
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setHeader(() => new EmptyComponent());
		ctx.ui.setFooter(() => new EmptyComponent());
		ctx.ui.setWorkingVisible(false);

		void refreshGit(ctx.cwd);

		const Editor = createBashPromptEditor(ctx, promptState);
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new Editor(tui, theme, keybindings));
	});

	const infoHandler = async (_args: string, ctx: ExtensionCommandContext) => {
		await showInfoUi(ctx, pi.getThinkingLevel());
	};

	pi.registerCommand("info", {
		description: "Show model, tokens, cost, and context usage for this session",
		handler: infoHandler,
	});
}
