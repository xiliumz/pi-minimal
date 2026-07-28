import type { Component } from "@earendil-works/pi-tui";

/** Zero-height component used to blank header/footer chrome. */
export class EmptyComponent implements Component {
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}
