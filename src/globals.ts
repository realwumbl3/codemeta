export const ID_MIN = 6;
export const ID_MAX = 32;

export const labelPrefix = '';
export const PILL_TEXT_DECORATION = 'none; outline: 1px solid currentColor; outline-offset: -2px; border-radius: 999px; padding: 0px 6px; opacity:1;';

export let activeSet = 'default';

export function getActiveSet(): string {
	return activeSet;
}

export function setActiveSet(name: string): void {
	activeSet = (name && name.trim()) ? name.trim() : 'default';
}
