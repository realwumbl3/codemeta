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
    // New preferred format: [123] (allow leading spaces)
    const bracket = afterMarkerText.match(/^\s*\[(\d{1,32})\]/);
    if (bracket) return bracket[1];
    // Legacy format: whitespace + digits
    const match = afterMarkerText.match(idRegex());
    return match ? match[1] : null;
}

export function findMarker(lineText: string): { markerStart: number; markerEnd: number } | null {
    // Support: // codemeta, //codemeta, # codemeta, #codemeta, legacy cm variants,
    // and HTML/CSS: <!-- codemeta, /* codemeta
    const patterns: RegExp[] = [
        /\/\/\s*(codemeta|cm)/g,   // JS/TS line comments
        /#\s*(codemeta|cm)/g,      // Python/shell comments
        /<!--\s*(codemeta|cm)/g,   // HTML comments
        /\/\*\s*(codemeta|cm)/g   // CSS/C-like block comments
    ];
    let best: { start: number; end: number } | null = null;
    for (const re of patterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lineText))) {
            const start = m.index;
            const end = m.index + m[0].length; // ends right after codemeta/cm
            if (!best || start < best.start) {
                best = { start, end };
            }
        }
    }
    return best ? { markerStart: best.start, markerEnd: best.end } : null;
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

// Extract lines from a YAML frontmatter block under a multiline key `refs: |`
// Returns an array of strings like "<count>@<relpath>". If none, returns [].
export function extractRefsLinesFromFrontmatter(text: string): string[] {
	if (!text.startsWith('---')) return [];
	const closeIdx = text.indexOf('\n---', 3);
	if (closeIdx === -1) return [];
	const header = text.slice(3, closeIdx);
	const lines = header.split(/\r?\n/);
	let inRefs = false;
	const refs: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!inRefs) {
			if (/^\s*refs\s*:\s*\|\s*$/.test(line)) {
				inRefs = true;
			}
			continue;
		}
		// We are inside the block scalar; it ends when dedented (no leading space)
		if (!/^\s+/.test(line)) {
			break;
		}
		const val = line.replace(/^\s+/, '');
		if (val.trim()) refs.push(val);
	}
	return refs;
}

// Update or remove the `refs: |` block inside YAML frontmatter.
// Returns the updated full text (header + body). If refsLines is empty, the block is removed.
export function setRefsLinesInFrontmatter(text: string, refsLines: string[]): string {
	if (!text.startsWith('---')) return text;
	const closeIdx = text.indexOf('\n---', 3);
	if (closeIdx === -1) return text;
	let header = text.slice(3, closeIdx);
	const body = text.slice(closeIdx + 4); // include everything after closing --- and its newline
	// Normalize: remove a single leading newline from header if present (avoid blank line after opening ---)
	if (header.startsWith('\r\n')) header = header.slice(2);
	else if (header.startsWith('\n')) header = header.slice(1);
	const lines = header.split(/\r?\n/);
	let out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (/^\s*refs\s*:\s*\|\s*$/.test(line)) {
			// skip existing block
			i++;
			while (i < lines.length && /^\s+/.test(lines[i])) i++;
			continue;
		}
		out.push(line);
		i++;
	}
	// Trim any leading empty lines to avoid growing blank space
	while (out.length > 0 && out[0].trim() === '') out.shift();
	if (refsLines.length > 0) {
		// Insert refs block at the end of the header for simplicity
		if (out.length > 0 && out[out.length - 1].trim() !== '') {
			out.push('');
		}
		out.push('refs: |');
		for (const r of refsLines) {
			out.push('  ' + r);
		}
	}
	const newHeader = out.join('\n');
	return `---\n${newHeader}\n---${body}`;
}

// Convenience: update a single relPath entry with a count inside the refs block.
// If count <= 0, the entry is removed. Returns updated text.
export function upsertRefCountInFragmentText(text: string, relPath: string, count: number): string {
	const current = extractRefsLinesFromFrontmatter(text);
	const map = new Map<string, number>();
	for (const line of current) {
		const m = line.match(/^(\d+)@(.+)$/);
		if (!m) continue;
		const c = Number(m[1]);
		const p = m[2];
		if (Number.isFinite(c) && p) map.set(p, c);
	}
	if (count > 0) {
		map.set(relPath, count);
	} else {
		map.delete(relPath);
	}
	const nextLines = Array.from(map.entries())
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([p, c]) => `${c}@${p}`);
	return setRefsLinesInFrontmatter(text, nextLines);
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


