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
