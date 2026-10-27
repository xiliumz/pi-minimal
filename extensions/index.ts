/**
 * pi-minimal
 *
 * Bash-style prompt for pi:
 *   ~/path (branch*):
 *   $ |
 *
 * Header/footer chrome removed. Session stats via /info.
 * Ctrl+O cycles tool rows: grouped (`N tools`) → title → collapsed → full.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { createBashPromptEditor } from "../src/editor.js";
import { fetchGitState, type GitState } from "../src/git.js";
import { showInfoUi } from "../src/info.js";
import { ToolRuns } from "../src/tool-runs.js";
import { createToolViewRenderer, nextToolView, type ToolView } from "../src/tool-view.js";
import { EmptyComponent } from "../src/ui.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function bashLayoutExtension(pi: ExtensionAPI): void {
	let activeTui: TUI | undefined;
	let git: GitState = { dirty: false };
	let isWorking = false;
	let spinnerIndex = 0;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;
	let activeCtx: ExtensionContext | undefined;

	const toolState = { view: "grouped" as ToolView, runs: new ToolRuns() };
	const toolRenderer = createToolViewRenderer(toolState);
	pi.registerToolRenderer(toolRenderer.resolve);

	// pi only redraws rows when the expanded flag changes, so flip it twice.
	const repaintTools = (ctx: ExtensionContext) => {
		const expanded = toolState.view === "full";
		ctx.ui.setToolsExpanded(!expanded);
		ctx.ui.setToolsExpanded(expanded);
	};

	const rebuildToolRuns = (ctx: ExtensionContext) => {
		toolState.runs.clear();
		toolRenderer.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message") toolState.runs.add(entry.message);
			else toolState.runs.break();
		}
		repaintTools(ctx);
	};

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
		onToolsExpand() {
			if (!activeCtx) return;
			toolState.view = nextToolView(toolState.view);
			repaintTools(activeCtx);
			// Info notices reuse pi's status line, replacing its `collapsed/expanded` text.
			activeCtx.ui.notify(`Tool output: ${toolState.view}`, "info");
		},
	};

	pi.on("message_end", (event) => {
		const changed = toolState.runs.add(event.message);
		if (toolState.view === "grouped") toolRenderer.redraw(changed);
	});

	pi.on("session_tree", (_event, ctx) => {
		if (ctx.mode === "tui") rebuildToolRuns(ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		if (ctx.mode === "tui") rebuildToolRuns(ctx);
	});

	pi.on("agent_start", () => {
		toolState.runs.break();
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
		activeCtx = undefined;
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setHeader(() => new EmptyComponent());
		ctx.ui.setFooter(() => new EmptyComponent());
		ctx.ui.setWorkingVisible(false);
		activeCtx = ctx;
		rebuildToolRuns(ctx);

		void refreshGit(ctx.cwd);

		const Editor = createBashPromptEditor(ctx, promptState);
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new Editor(tui, theme, keybindings));
	});

	const showInfo = async (ctx: ExtensionContext) => {
		await showInfoUi(ctx, pi.getThinkingLevel());
	};

	pi.registerCommand("info", {
		description: "Show model, tokens, cost, and context usage for this session",
		handler: (_args, ctx) => showInfo(ctx),
	});

	pi.registerShortcut("f8", {
		description: "Show session info",
		handler: showInfo,
	});
}
