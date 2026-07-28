import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { formatCwd, formatTokens } from "./format.js";

interface TokenStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	assistantMessages: number;
	userMessages: number;
	toolCalls: number;
}

type SessionManagerLite = {
	getBranch: () => ReadonlyArray<{
		type: string;
		message?: {
			role?: string;
			content?: unknown;
			usage?: AssistantMessage["usage"];
		};
	}>;
	getSessionName?: () => string | undefined;
	getSessionFile?: () => string | undefined;
	getSessionId?: () => string | undefined;
};

function collectTokenStats(ctx: ExtensionContext): TokenStats {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	let assistantMessages = 0;
	let userMessages = 0;
	let toolCalls = 0;

	const sm = ctx.sessionManager as SessionManagerLite;
	for (const entry of sm.getBranch()) {
		if (entry.type !== "message" || !entry.message) continue;
		const msg = entry.message;
		if (msg.role === "user") {
			userMessages++;
			continue;
		}
		if (msg.role !== "assistant") continue;

		assistantMessages++;
		input += msg.usage?.input ?? 0;
		output += msg.usage?.output ?? 0;
		cacheRead += msg.usage?.cacheRead ?? 0;
		cacheWrite += msg.usage?.cacheWrite ?? 0;
		cost += msg.usage?.cost?.total ?? 0;
		if (Array.isArray(msg.content)) {
			toolCalls += msg.content.filter(
				(c) => typeof c === "object" && c !== null && (c as { type?: string }).type === "toolCall",
			).length;
		}
	}

	return { input, output, cacheRead, cacheWrite, cost, assistantMessages, userMessages, toolCalls };
}

export function buildInfoLines(
	ctx: ExtensionCommandContext,
	theme: Theme,
	thinkingLevel: string,
): string[] {
	const stats = collectTokenStats(ctx);
	const usage = ctx.getContextUsage();
	const model = ctx.model;
	const sm = ctx.sessionManager as SessionManagerLite;
	const dim = (s: string) => theme.fg("dim", s);
	const label = (k: string, v: string) => `${dim(k.padEnd(14))} ${v}`;
	const lines: string[] = [];

	lines.push(theme.bold("Session"));
	const sessionName = sm.getSessionName?.();
	if (sessionName) lines.push(label("Name", sessionName));
	lines.push(label("File", sm.getSessionFile?.() ?? "in-memory"));
	const sessionId = sm.getSessionId?.();
	if (sessionId) lines.push(label("ID", sessionId));
	lines.push(label("Cwd", formatCwd(ctx.cwd)));
	lines.push("");

	lines.push(theme.bold("Model"));
	lines.push(label("Model", model ? `${model.provider}/${model.id}` : "none"));
	lines.push(label("Thinking", thinkingLevel));
	if (model?.contextWindow) {
		lines.push(label("Window", formatTokens(model.contextWindow)));
	}
	lines.push("");

	lines.push(theme.bold("Context"));
	if (usage?.percent != null && usage.tokens != null) {
		lines.push(
			label(
				"Used",
				`${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} (${Math.round(usage.percent)}%)`,
			),
		);
	} else if (usage?.contextWindow) {
		lines.push(label("Window", formatTokens(usage.contextWindow)));
		lines.push(label("Used", "n/a (no estimate yet)"));
	} else {
		lines.push(label("Used", "n/a"));
	}
	lines.push("");

	lines.push(theme.bold("Tokens (branch)"));
	const promptTokens = stats.input + stats.cacheRead + stats.cacheWrite;
	lines.push(label("Input", formatTokens(promptTokens)));
	if (promptTokens > 0 && (stats.cacheRead > 0 || stats.cacheWrite > 0)) {
		const hit = ((stats.cacheRead / promptTokens) * 100).toFixed(1);
		lines.push(label("  cached", `${formatTokens(stats.cacheRead)} (${hit}%)`));
		lines.push(label("  uncached", formatTokens(stats.input + stats.cacheWrite)));
	}
	lines.push(label("Output", formatTokens(stats.output)));
	lines.push(
		label("Total", formatTokens(stats.input + stats.output + stats.cacheRead + stats.cacheWrite)),
	);
	lines.push(label("Cost", `$${stats.cost.toFixed(4)}`));
	lines.push("");

	lines.push(theme.bold("Messages (branch)"));
	lines.push(label("User", `${stats.userMessages}`));
	lines.push(label("Assistant", `${stats.assistantMessages}`));
	lines.push(label("Tool calls", `${stats.toolCalls}`));

	return lines;
}

export async function showInfoUi(
	ctx: ExtensionCommandContext,
	thinkingLevel: string,
): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		const plainTheme = {
			bold: (s: string) => s,
			fg: (_c: string, s: string) => s,
		} as Theme;
		ctx.ui.notify(buildInfoLines(ctx, plainTheme, thinkingLevel).join("\n"), "info");
		return;
	}

	await ctx.ui.custom((tui, theme, _kb, done) => {
		const body = buildInfoLines(ctx, theme, thinkingLevel);
		return {
			render(width: number): string[] {
				const out: string[] = [""];
				out.push(truncateToWidth(theme.fg("accent", theme.bold(" /info ")), width));
				out.push(truncateToWidth(theme.fg("dim", "─".repeat(Math.min(width, 40))), width));
				for (const line of body) {
					out.push(truncateToWidth(line, width));
				}
				out.push("");
				out.push(truncateToWidth(theme.fg("dim", "Enter/Esc to close"), width));
				out.push("");
				return out;
			},
			invalidate() {},
			handleInput(data: string) {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
					done(undefined);
					tui.requestRender();
				}
			},
		};
	});
}
