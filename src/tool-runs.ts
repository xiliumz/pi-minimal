import type { MessageEndEvent } from "@earendil-works/pi-coding-agent";

type TranscriptMessage = MessageEndEvent["message"];

export interface ToolRunPosition {
	/** First call of the run — the one that draws `N tools`. */
	isHead: boolean;
	/** Number of calls in the run so far. */
	count: number;
}

/**
 * Groups tool calls that appear back to back in the transcript. A run ends at
 * any visible non-tool content: assistant text, thinking, user or custom
 * messages. Tool results never end a run.
 */
export class ToolRuns {
	private current: string[] = [];
	private readonly runById = new Map<string, string[]>();

	clear(): void {
		this.current = [];
		this.runById.clear();
	}

	/** Feed one finished message. Returns tool call ids whose run changed. */
	add(message: TranscriptMessage): string[] {
		if (message.role === "toolResult") return [];
		if (message.role !== "assistant") {
			this.current = [];
			return [];
		}

		const changed: string[] = [];
		for (const block of message.content) {
			if (block.type !== "toolCall") {
				if (isVisible(block)) this.current = [];
				continue;
			}
			if (this.runById.has(block.id)) continue;
			const head = this.current[0];
			if (head) changed.push(head);
			this.current.push(block.id);
			this.runById.set(block.id, this.current);
			changed.push(block.id);
		}
		return changed;
	}

	/** Ends the open run, e.g. at a compaction or other non-message entry. */
	break(): void {
		this.current = [];
	}

	position(toolCallId: string): ToolRunPosition | undefined {
		const run = this.runById.get(toolCallId);
		if (!run) return undefined;
		return { isHead: run[0] === toolCallId, count: run.length };
	}
}

function isVisible(block: { type: string; text?: string; thinking?: string }): boolean {
	if (block.type === "text") return Boolean(block.text?.trim());
	if (block.type === "thinking") return Boolean(block.thinking?.trim());
	return true;
}
