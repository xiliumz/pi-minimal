import {
	keyHint,
	type AgentToolResult,
	type Theme,
	type ToolRendererResolver,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Box, Text, type Component } from "@earendil-works/pi-tui";
import type { ToolRuns } from "./tool-runs.js";
import { EmptyComponent } from "./ui.js";

/** pi does not export `ToolRenderContext` from its entry point. */
type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

/**
 * How tool rows are drawn; Ctrl+O cycles them in this order.
 * - grouped: back-to-back calls collapse into one `N tools` line
 * - title:     one line per call with just the tool name
 * - collapsed: pi's default truncated preview
 * - full:      pi's normal expanded output
 */
export type ToolView = "grouped" | "title" | "collapsed" | "full";

const NEXT_VIEW: Record<ToolView, ToolView> = {
	grouped: "title",
	title: "collapsed",
	collapsed: "full",
	full: "grouped",
};

export function nextToolView(view: ToolView): ToolView {
	return NEXT_VIEW[view];
}

/** Views drawn by pi-minimal itself rather than the tool's own renderers. */
function isSummaryView(view: ToolView): boolean {
	return view === "grouped" || view === "title";
}

/** Same limits pi uses for tools without renderers. */
const PREVIEW_LINES = 10;
const PREVIEW_ARGS_CHARS = 100;

export interface ToolViewState {
	readonly view: ToolView;
	readonly runs: ToolRuns;
}

/** Per-row bookkeeping: the row's redraw hook, plus the base renderer's components and our frame for collapsed/full view. */
interface RowCache {
	redraw?: () => void;
	call?: Component;
	result?: Component;
	frame?: Box;
}

export interface ToolViewRenderer {
	resolve: ToolRendererResolver;
	/** Redraw rows already on screen, e.g. after their run grew. */
	redraw(toolCallIds: string[]): void;
	/** Drop per-row caches, e.g. when the transcript is rebuilt. */
	clear(): void;
}

/**
 * Renderer resolver that lets pi-minimal decide what every tool row shows,
 * including MCP and other extensions' tools.
 */
export function createToolViewRenderer(state: ToolViewState): ToolViewRenderer {
	const rows = new Map<string, RowCache>();
	return {
		resolve: (toolName, next) => wrapRenderers(toolName, next(), state, rows),
		redraw: (toolCallIds) => {
			for (const id of toolCallIds) rows.get(id)?.redraw?.();
		},
		clear: () => rows.clear(),
	};
}

/**
 * Rows always use `renderShell: "self"` — pi fixes the shell when a row is
 * created, and only "self" lets a hidden row take zero lines. Full view
 * redraws pi's default box itself.
 */
function wrapRenderers(
	toolName: string,
	base: ToolRenderers | undefined,
	state: ToolViewState,
	rows: Map<string, RowCache>,
): ToolRenderers {
	const row = (id: string) => {
		let cache = rows.get(id);
		if (!cache) rows.set(id, (cache = {}));
		return cache;
	};

	return {
		renderShell: "self",

		renderCall(args, theme, context) {
			const cache = row(context.toolCallId);
			cache.redraw = context.invalidate;
			if (isSummaryView(state.view)) return summaryLine(toolName, theme, context, state);

			const baseContext = { ...context, lastComponent: cache.call };
			cache.call = base?.renderCall
				? base.renderCall(args, theme, baseContext)
				: new Text(formatArgs(toolName, args, theme, context.expanded), 0, 0);
			if (base?.renderShell === "self") return cache.call;

			cache.frame = new Box(context.outputPad, 1, rowBackground(theme, context));
			cache.frame.addChild(cache.call);
			return cache.frame;
		},

		renderResult(result, options, theme, context) {
			if (isSummaryView(state.view)) return new EmptyComponent();

			const cache = row(context.toolCallId);
			const baseContext = { ...context, lastComponent: cache.result };
			cache.result = base?.renderResult
				? base.renderResult(result, options, theme, baseContext)
				: fallbackResult(result, theme, options.expanded);
			if (base?.renderShell === "self" || !cache.frame) return cache.result;

			// Default-shell tools draw call + result inside one box, like pi does.
			cache.frame.addChild(cache.result);
			return new EmptyComponent();
		},
	};
}

function summaryLine(
	toolName: string,
	theme: Theme,
	context: ToolRenderContext,
	state: ToolViewState,
): Component {
	const background = rowBackground(theme, context);
	const position = state.view === "grouped" ? state.runs.position(context.toolCallId) : undefined;
	if (position && position.count > 1) {
		if (!position.isHead) return new EmptyComponent();
		const label = theme.fg("toolTitle", theme.bold(`${position.count} tools`));
		return new Text(label, context.outputPad, 1, background);
	}
	const color = context.isError ? "error" : "toolTitle";
	return new Text(theme.fg(color, theme.bold(toolName)), context.outputPad, 1, background);
}

function rowBackground(theme: Theme, context: ToolRenderContext): (text: string) => string {
	if (context.isPartial) return (text) => theme.bg("toolPendingBg", text);
	if (context.isError) return (text) => theme.bg("toolErrorBg", text);
	return (text) => theme.bg("toolSuccessBg", text);
}

/**
 * Tools without their own renderer: name plus one `key: value` line per
 * argument, or a one-line `key=value` preview when collapsed.
 */
function formatArgs(toolName: string, args: unknown, theme: Theme, expanded: boolean): string {
	const header = theme.fg("toolTitle", theme.bold(toolName));
	if (!args || typeof args !== "object") return header;
	if (!expanded) {
		const pairs = Object.entries(args)
			.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`)
			.join(" ");
		if (!pairs) return header;
		const preview = pairs.length > PREVIEW_ARGS_CHARS ? `${pairs.slice(0, PREVIEW_ARGS_CHARS - 3)}...` : pairs;
		return `${header} ${theme.fg("muted", preview)}`;
	}
	const lines = Object.entries(args).map(([key, value]) => {
		const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
		return `  ${key}: ${text.replace(/\r/g, "").split("\n").join("\n    ")}`;
	});
	return lines.length > 0 ? `${header}\n${theme.fg("muted", lines.join("\n"))}` : header;
}

function fallbackResult(result: AgentToolResult<unknown>, theme: Theme, expanded: boolean): Component {
	const output = result.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n")
		.trim();
	if (!output) return new EmptyComponent();
	const lines = output.split("\n");
	const shown = expanded ? lines : lines.slice(0, PREVIEW_LINES);
	let text = shown.map((line) => theme.fg("toolOutput", line)).join("\n");
	const remaining = lines.length - shown.length;
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}
	return new Text(text, 0, 0);
}
