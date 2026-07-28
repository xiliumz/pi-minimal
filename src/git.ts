import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface GitState {
	branch?: string;
	dirty: boolean;
}

export async function fetchGitState(pi: ExtensionAPI, cwd: string): Promise<GitState> {
	try {
		const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd });
		const branch = branchResult?.stdout?.trim() || undefined;

		const dirtyResult = await pi.exec("git", ["status", "--porcelain"], { cwd });
		const dirty = Boolean(dirtyResult?.stdout?.trim());

		return { branch: branch || undefined, dirty };
	} catch {
		// Stale ctx after reload/session replace, or non-git cwd.
		return { dirty: false };
	}
}
