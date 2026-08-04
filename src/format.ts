import { visibleWidth } from "@earendil-works/pi-tui";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
	return s.replace(ANSI_RE, "");
}

/** Editor top/bottom chrome or scroll indicators from CustomEditor.render(). */
export function isBorderOrScrollLine(line: string): boolean {
	const plain = stripAnsi(line).trim();
	if (!plain) return true;
	if (/^─+$/.test(plain)) return true;
	if (/^─+\s*[↑↓]/.test(plain)) return true;
	return false;
}

export interface WrapChunk {
	text: string;
	startIndex: number;
	endIndex: number;
}

export interface GraphemeSeg {
	segment: string;
	index: number;
}

/**
 * Soft-wrap one logical line.
 * `firstWidth` applies only to the first visual chunk (room for a same-line prompt);
 * later chunks use `restWidth` (full editor width).
 */
export function wordWrapLineVariable(
	line: string,
	firstWidth: number,
	restWidth: number,
	preSegmented?: GraphemeSeg[],
): WrapChunk[] {
	if (!line) {
		return [{ text: "", startIndex: 0, endIndex: 0 }];
	}
	const first = Math.max(1, firstWidth);
	const rest = Math.max(1, restWidth);
	const segments =
		preSegmented ??
		[...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)].map((s) => ({
			segment: s.segment,
			index: s.index,
		}));

	const chunks: WrapChunk[] = [];
	let maxWidth = first;
	let currentWidth = 0;
	let chunkStart = 0;
	let wrapOppIndex = -1;
	let wrapOppWidth = 0;

	const pushChunk = (end: number) => {
		chunks.push({ text: line.slice(chunkStart, end), startIndex: chunkStart, endIndex: end });
		// After the first visual line, continuations get the full width.
		maxWidth = rest;
	};

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;
		const grapheme = seg.segment;
		const gWidth = visibleWidth(grapheme);
		const charIndex = seg.index;
		const isWs = /\s/.test(grapheme);

		if (currentWidth + gWidth > maxWidth) {
			if (wrapOppIndex >= 0 && currentWidth - wrapOppWidth + gWidth <= maxWidth) {
				pushChunk(wrapOppIndex);
				chunkStart = wrapOppIndex;
				currentWidth -= wrapOppWidth;
			} else if (chunkStart < charIndex) {
				pushChunk(charIndex);
				chunkStart = charIndex;
				currentWidth = 0;
			}
			wrapOppIndex = -1;
			wrapOppWidth = 0;
		}

		// Single grapheme wider than the line — hard-split by force.
		if (gWidth > maxWidth) {
			if (chunkStart < charIndex) {
				pushChunk(charIndex);
				chunkStart = charIndex;
			}
			// Put the oversized grapheme on its own chunk and continue.
			pushChunk(charIndex + grapheme.length);
			chunkStart = charIndex + grapheme.length;
			currentWidth = 0;
			wrapOppIndex = -1;
			wrapOppWidth = 0;
			continue;
		}

		currentWidth += gWidth;
		const next = segments[i + 1];
		if (isWs && next && !/\s/.test(next.segment)) {
			// Prefer breaking after a whitespace run (at the start of the next word).
			wrapOppIndex = next.index;
			wrapOppWidth = currentWidth;
		}
	}

	chunks.push({ text: line.slice(chunkStart), startIndex: chunkStart, endIndex: line.length });
	return chunks.length > 0 ? chunks : [{ text: "", startIndex: 0, endIndex: 0 }];
}

export function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd.startsWith(home)) {
		return `~${cwd.slice(home.length)}`;
	}
	return cwd;
}

export function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}
