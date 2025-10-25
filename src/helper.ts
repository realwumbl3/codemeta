import * as vscode from 'vscode';
import { getActiveSet } from './globals';

export function getCmsFolderName(): string {
	return vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', '.cms');
}
export function getCmsFolderUri(folder: vscode.WorkspaceFolder): vscode.Uri {
	return vscode.Uri.joinPath(folder.uri, getCmsFolderName());
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number): (...args: Parameters<T>) => void {
	let timer: NodeJS.Timeout | undefined;
	return (...args: Parameters<T>) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delayMs);
	};
}

function idRegex(): RegExp {
	return /^\s+(\d{1,32})\b/;
}

export function extractIdAfterMarkerText(afterMarkerText: string): string | null {
    // New preferred format: [123]
    const bracket = afterMarkerText.match(/^\[(\d{1,32})\]/);
    if (bracket) return bracket[1];
    // Legacy format: whitespace + digits
    const match = afterMarkerText.match(idRegex());
    return match ? match[1] : null;
}

export function findMarker(lineText: string): { markerStart: number; markerEnd: number } | null {
    // Prefer explicit codemeta markers, but keep legacy cm for triggers
    const idxCodemetaSlash = lineText.indexOf('//codemeta');
    if (idxCodemetaSlash >= 0) {
        // length of "//codemeta" is 10
        return { markerStart: idxCodemetaSlash, markerEnd: idxCodemetaSlash + 10 };
    }
    const idxCodemetaHash = lineText.indexOf('#codemeta');
    if (idxCodemetaHash >= 0) {
        // length of "#codemeta" is 9
        return { markerStart: idxCodemetaHash, markerEnd: idxCodemetaHash + 9 };
    }
    const idx1 = lineText.indexOf('//cm');
    if (idx1 >= 0) {
        return { markerStart: idx1, markerEnd: idx1 + 4 };
    }
    const idx2 = lineText.indexOf('#cm');
    if (idx2 >= 0) {
        return { markerStart: idx2, markerEnd: idx2 + 3 };
    }
    return null;
}

export function generateId(length: number): string {
	let s = '';
	while (s.length < length) {
		s += Math.floor(Math.random() * 10).toString();
	}
	return s.slice(0, length);
}

type CmsState = { nextId: number };

async function readCmsState(folder: vscode.WorkspaceFolder): Promise<CmsState> {
    const cmsFolder = getCmsFolderUri(folder);
    await vscode.workspace.fs.createDirectory(cmsFolder);
    const stateUri = vscode.Uri.joinPath(cmsFolder, 'state.json');
    try {
        const data = await vscode.workspace.fs.readFile(stateUri);
        const text = Buffer.from(data).toString('utf8');
        const parsed = JSON.parse(text);
        const nextId = typeof parsed?.nextId === 'number' && isFinite(parsed.nextId) && parsed.nextId >= 0 ? parsed.nextId : 0;
        return { nextId };
    } catch {
        return { nextId: 0 };
    }
}

async function writeCmsState(folder: vscode.WorkspaceFolder, state: CmsState): Promise<void> {
    const cmsFolder = getCmsFolderUri(folder);
    await vscode.workspace.fs.createDirectory(cmsFolder);
    const stateUri = vscode.Uri.joinPath(cmsFolder, 'state.json');
    const text = JSON.stringify({ nextId: state.nextId });
    await vscode.workspace.fs.writeFile(stateUri, Buffer.from(text, 'utf8'));
}

export async function allocateNextId(length: number): Promise<string> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        throw new Error('No workspace folder');
    }
    const state = await readCmsState(folder);
    const idNumber = state.nextId || 0;
    const id = String(idNumber);
    state.nextId = idNumber + 1;
    await writeCmsState(folder, state);
    return id;
}

export function parseFrontmatterAndCategory(text: string): { body: string; category?: string } {
	let category: string | undefined;
	if (text.startsWith('---')) {
		const closeIdx = text.indexOf('\n---', 3);
		if (closeIdx !== -1) {
			const header = text.slice(3, closeIdx).trim();
			const catMatch = header.match(/^\s*category:\s*(.+)$/mi);
			if (catMatch) {
				category = catMatch[1].trim();
			}
			const after = text.slice(closeIdx + 4).replace(/^\r?\n/, '');
			return { body: after, category };
		}
	}
	return { body: text, category };
}

export function truncateLines(text: string, maxLines: number, maxChars: number): string {
	const lines = text.split(/\r?\n/);
	let out = lines.slice(0, maxLines).join('\n');
	if (out.length > maxChars) {
		out = out.slice(0, maxChars).trimEnd();
	}
	if (lines.length > maxLines || text.length > maxChars) {
		out += '\n\n…';
	}
	return out;
}

export function findContentStartLine(document: vscode.TextDocument): number {
	if (document.lineCount === 0) return 0;
	const first = document.lineAt(0).text;
	if (first.trim() !== '---') return 0;
	for (let i = 1; i < document.lineCount; i++) {
		if (document.lineAt(i).text.trim() === '---') {
			return Math.min(i + 1, document.lineCount - 1);
		}
	}
	return 0;
}

export async function ensureSetFolderExists(setName: string): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) return;
	const cmsFolder = getCmsFolderUri(folder);
	const setFolder = vscode.Uri.joinPath(cmsFolder, setName || 'default');
	await vscode.workspace.fs.createDirectory(setFolder);
}

export async function listAvailableSets(): Promise<string[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) return ['default'];
	const cmsFolder = getCmsFolderUri(folder);
	try {
		await vscode.workspace.fs.createDirectory(cmsFolder);
		const entries = await vscode.workspace.fs.readDirectory(cmsFolder);
		const dirs = entries
			.filter(([_, type]) => type === vscode.FileType.Directory)
			.map(([name]) => name)
			.filter(Boolean);
		if (!dirs.includes('default')) dirs.unshift('default');
		const uniq = Array.from(new Set([getActiveSet() || 'default', ...dirs]));
		return uniq;
	} catch {
		return [getActiveSet() || 'default', 'default'];
	}
}

export async function findAnyFragmentUri(sourceUri: vscode.Uri, id: string): Promise<vscode.Uri | null> {
	const folder = vscode.workspace.getWorkspaceFolder(sourceUri) || vscode.workspace.workspaceFolders?.[0];
	if (!folder) return null;
	const cmsFolder = getCmsFolderUri(folder);
	try {
		await vscode.workspace.fs.createDirectory(cmsFolder);
	} catch { }
	const rootCandidate = vscode.Uri.joinPath(cmsFolder, `${id}.md`);
	try {
		await vscode.workspace.fs.stat(rootCandidate);
		return rootCandidate;
	} catch { }
	try {
		const entries = await vscode.workspace.fs.readDirectory(cmsFolder);
		for (const [name, type] of entries) {
			if (type !== vscode.FileType.Directory) continue;
			const candidate = vscode.Uri.joinPath(cmsFolder, name, `${id}.md`);
			try {
				await vscode.workspace.fs.stat(candidate);
				return candidate;
			} catch { }
		}
	} catch { }
	return null;
}

export async function ensureFragmentFile(sourceUri: vscode.Uri, id: string): Promise<{ uri: vscode.Uri; created: boolean }> {
	const folder = vscode.workspace.getWorkspaceFolder(sourceUri) || vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder');
	}
	const cmsFolder = getCmsFolderUri(folder);
	await vscode.workspace.fs.createDirectory(cmsFolder);
	const setFolder = vscode.Uri.joinPath(cmsFolder, getActiveSet() || 'default');
	await vscode.workspace.fs.createDirectory(setFolder);
	const fragmentUri = vscode.Uri.joinPath(setFolder, `${id}.md`);
	let created = false;
	try {
		await vscode.workspace.fs.stat(fragmentUri);
	} catch {
		created = true;
		const now = new Date().toISOString();
		const defaultCategory = vscode.workspace.getConfiguration('codemeta').get<string>('defaultCategory', 'INFO');
		const contents = Buffer.from(
			`---\n` +
			`id: ${id}\n` +
			`created: ${now}\n` +
			`category: ${defaultCategory}\n` +
			`---\n\n`
		);
		await vscode.workspace.fs.writeFile(fragmentUri, contents);
	}
	return { uri: fragmentUri, created };
}

export async function showFragmentWithoutExplorerReveal(uri: vscode.Uri, preserveFocus: boolean): Promise<vscode.TextEditor | undefined> {
	const explorerConfig = vscode.workspace.getConfiguration('explorer');
	const original = explorerConfig.get<boolean>('autoReveal');
	try {
		if (original !== false) {
			await explorerConfig.update('autoReveal', false, vscode.ConfigurationTarget.Workspace);
		}
		return await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus });
	} catch {
		return await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus });
	} finally {
		try {
			if (original !== false) {
				await explorerConfig.update('autoReveal', original, vscode.ConfigurationTarget.Workspace);
			}
		} catch { }
	}
}

export async function getFragmentPreviewAndCategory(sourceUri: vscode.Uri, id: string): Promise<{ preview: string | null; categoryLabel: string; inline: string | null }> {
	const uri = await findAnyFragmentUri(sourceUri, id);
	let category = 'INFO';
	if (!uri) return { preview: null, categoryLabel: category, inline: null };
	try {
		const data = await vscode.workspace.fs.readFile(uri);
		const text = Buffer.from(data).toString('utf8');
		const { body, category: parsedCat } = parseFrontmatterAndCategory(text);
		if (parsedCat) category = parsedCat;
		const trimmed = body.trim();
		if (!trimmed) return { preview: null, categoryLabel: category, inline: null };
		const firstLine = trimmed.split(/\r?\n/)[0]?.trim() || '';
		const hasMore = /\r?\n/.test(trimmed);
		const inline = firstLine ? `${firstLine}${hasMore ? '…' : ''}` : '';
		return { preview: truncateLines(trimmed, 12, 600), categoryLabel: category, inline };
	} catch {
		return { preview: null, categoryLabel: category, inline: null };
	}
}


