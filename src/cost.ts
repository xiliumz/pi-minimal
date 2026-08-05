/**
 * Cost section support for /info: cache re-billing (waste) and per-model
 * cost breakdown.
 *
 * Port of pi-coding-agent internals — `core/cache-stats.ts` (computeCacheWaste)
 * and `core/usage-totals.ts` (getUsageCostBreakdown) — neither is exported from
 * the package root. Kept in sync manually with those files.
 *
 * Scope: the current branch's assistant-message usage, matching the
 * "Tokens (branch)" stats in /info so the Cost section reconciles.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";

/** Per-turn misses at or below this are cache breakpoint granularity noise. */
const NOISE_FLOOR_TOKENS = 1024;

export interface CacheWasteTotals {
	missedTokens: number;
	missedCost: number;
	/** Number of counted misses (turns above the noise floor). */
	missCount: number;
}

export interface UsageCostBreakdownEntry {
	key: string;
	cost: number;
	tokens: number;
}

/** Lite view of a session branch entry (structural subset of SessionEntry). */
export interface BranchEntry {
	type: string;
	message?: {
		role?: string;
		provider?: string;
		model?: string;
		responseModel?: string;
		content?: unknown;
		usage?: AssistantMessage["usage"];
	};
}

/** Minimal pricing lookup, satisfied by ModelRegistry. Cost is $/million tokens. */
export interface ModelPriceSource {
	find(provider: string, modelId: string): { cost: { cacheRead: number } } | undefined;
}

interface PrevRequest {
	promptTokens: number;
	reportedCache: boolean;
}

interface MissRecord {
	missedTokens: number;
	missedCost: number;
}

function detectMiss(
	prev: PrevRequest | undefined,
	msg: NonNullable<BranchEntry["message"]>,
	models: ModelPriceSource,
): MissRecord | undefined {
	const usage = msg.usage;
	if (!usage) return undefined;
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	// A zero-cache turn only counts when cache activity was reported before:
	// on cache-read-only providers that is a total miss, while on providers
	// that never report caching it means nothing.
	if (!prev || promptTokens <= 0 || (usage.cacheRead + usage.cacheWrite === 0 && !prev.reportedCache)) {
		return undefined;
	}
	const missedTokens = Math.min(prev.promptTokens, promptTokens) - usage.cacheRead;
	if (missedTokens <= NOISE_FLOOR_TOKENS) return undefined;

	// Extra cost = missed tokens billed at the actual paid rate (input/cacheWrite,
	// incl. write premium) instead of the cache-read rate. Missed tokens can only
	// land in the input or cacheWrite buckets, so the paid rate comes straight
	// from this message's own cost breakdown.
	const paidTokens = usage.input + usage.cacheWrite;
	const paidPerToken = paidTokens > 0 ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens : 0;
	const readPerToken =
		usage.cacheRead > 0
			? usage.cost.cacheRead / usage.cacheRead
			: (models.find(msg.provider ?? "", msg.model ?? "")?.cost.cacheRead ?? 0) / 1_000_000;

	return {
		missedTokens,
		missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
	};
}

function asPreviousRequest(
	msg: NonNullable<BranchEntry["message"]>,
	reportedCache: boolean,
): PrevRequest | undefined {
	const usage = msg.usage;
	if (!usage) return undefined;
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	if (promptTokens <= 0) return undefined;
	return {
		promptTokens,
		reportedCache: reportedCache || usage.cacheRead + usage.cacheWrite > 0,
	};
}

/**
 * Cumulative cache waste across the branch: prompt tokens that should have been
 * cache reads (they were in the previous turn's prompt) but were re-billed.
 */
export function computeCacheWaste(
	entries: readonly BranchEntry[],
	models: ModelPriceSource,
): CacheWasteTotals {
	let prev: PrevRequest | undefined;
	const totals: CacheWasteTotals = { missedTokens: 0, missedCost: 0, missCount: 0 };
	for (const entry of entries) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			// The context legitimately changed; the next turn's prompt is new
			// content, not re-billed content. Model switches are NOT exempt:
			// they re-bill the full prompt and should be counted.
			prev = undefined;
			continue;
		}
		if (entry.type === "message" && entry.message?.role === "assistant") {
			const miss = detectMiss(prev, entry.message, models);
			if (miss) {
				totals.missedTokens += miss.missedTokens;
				totals.missedCost += miss.missedCost;
				totals.missCount += 1;
			}
			prev = asPreviousRequest(entry.message, prev?.reportedCache ?? false) ?? prev;
		}
	}
	return totals;
}

/**
 * Group assistant usage by model (`provider/responseModel ?? model`), sorted by
 * cost descending. Scoped to the branch so the lines reconcile with the Total.
 */
export function getUsageCostBreakdown(entries: readonly BranchEntry[]): UsageCostBreakdownEntry[] {
	const costByKey = new Map<string, { cost: number; tokens: number }>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg?.role !== "assistant" || !msg.usage) continue;
		const key = `${msg.provider ?? ""}/${msg.responseModel ?? msg.model ?? ""}`;
		const totals = costByKey.get(key) ?? { cost: 0, tokens: 0 };
		totals.cost += msg.usage.cost.total;
		totals.tokens += msg.usage.input + msg.usage.output + msg.usage.cacheRead + msg.usage.cacheWrite;
		costByKey.set(key, totals);
	}
	return Array.from(costByKey, ([key, totals]) => ({ key, ...totals }))
		.filter((entry) => entry.cost > 0 || entry.tokens > 0)
		.sort((a, b) => b.cost - a.cost);
}
