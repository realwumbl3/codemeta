import * as vscode from 'vscode';

const labelPrefix = '';
const PILL_TEXT_DECORATION = 'none; outline: 1px solid currentColor; outline-offset: -2px; border-radius: 999px; padding: 0px 6px; opacity:1;';

let isApplyingEdit = false;
let activeSet = 'default';
type CmItem = { range: vscode.Range; hoverMessage?: vscode.MarkdownString; inline?: string };
// Unified ID utilities
const ID_MIN = 6;
const ID_MAX = 32;
function idRegex(): RegExp {
	return /^\s+(\d{6,32})\b/;
}
function extractIdAfterMarkerText(afterMarkerText: string): string | null {
	const match = afterMarkerText.match(idRegex());
	return match ? match[1] : null;
}
function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number): (...args: Parameters<T>) => void {
	let timer: NodeJS.Timeout | undefined;
	return (...args: Parameters<T>) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delayMs);
	};
}

export function activate(context: vscode.ExtensionContext): void {
	// Initialize active set from workspace state
	const savedSet = context.workspaceState.get<string>('codemeta.activeSet', 'default');
	activeSet = (savedSet && savedSet.trim()) ? savedSet : 'default';

	// Ensure the default and current active set folders exist
	(async () => {
		try {
			await ensureSetFolderExists('default');
			if (activeSet !== 'default') {
				await ensureSetFolderExists(activeSet);
			}
		} catch {
			// ignore on activation
		}
	})();
	const createFragmentCmd = vscode.commands.registerCommand('codemeta.createFragment', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		await handlePotentialMarker(editor.document, editor.selection.active.line, editor);
	});
	let debouncedRefresh: () => void;

	const changeListener = vscode.workspace.onDidChangeTextDocument(async (e) => {
		// Do not react to undo/redo operations to avoid fighting the user's undo
		if (e.reason === vscode.TextDocumentChangeReason.Undo || e.reason === vscode.TextDocumentChangeReason.Redo) {
			return;
		}
		if (isApplyingEdit) {
			return;
		}
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.toString() !== e.document.uri.toString()) {
			return;
		}
		// Try to handle marker creation only when a space is typed immediately after the marker with no existing ID
		if (e.contentChanges.length === 1 && e.contentChanges[0].text === ' ') {
			const ch = e.contentChanges[0];
			const ln = ch.range.start.line;
			const pos = ch.range.start.character; // position in pre-change line
			const newLine = e.document.lineAt(ln).text;
			let preLine = newLine;
			if (pos <= newLine.length && newLine.charAt(pos) === ' ') {
				preLine = newLine.slice(0, pos) + newLine.slice(pos + 1);
			}
			const markerPre = findMarker(preLine);
			if (markerPre && pos === markerPre.markerEnd) {
				const afterPre = preLine.slice(markerPre.markerEnd);
				const preId = extractIdAfterMarkerText(afterPre);
				if (!preId) {
					await handlePotentialMarker(e.document, ln, editor);
				}
			}
		}
		// Inline bracket preview removed; rely on debounced pill refresh instead
		if (debouncedRefresh) debouncedRefresh();
	});

	const openFragmentCmd = vscode.commands.registerCommand('codemeta.openFragmentAtLine', async (uriString?: string, lineNumber?: number) => {
		let document: vscode.TextDocument | undefined;
		let editor = vscode.window.activeTextEditor;
		if (uriString) {
			const uri = vscode.Uri.parse(uriString);
			document = await vscode.workspace.openTextDocument(uri);
			const visible = vscode.window.visibleTextEditors.find((ed) => ed.document.uri.toString() === uri.toString());
			if (visible) {
				editor = visible;
			}
		} else {
			document = editor?.document;
		}
		if (!document) {
			return;
		}
		const targetLine = typeof lineNumber === 'number' ? lineNumber : (editor ? editor.selection.active.line : 0);
		const line = document.lineAt(targetLine);
		const markerInfo = findMarker(line.text);
		if (!markerInfo) {
			return;
		}
		const afterMarker = line.text.slice(markerInfo.markerEnd);
		const maybeId = extractIdAfterMarkerText(afterMarker);
		if (maybeId) {
			const id = maybeId;
			const existing = await findAnyFragmentUri(document.uri, id);
			const creation = existing ? { uri: existing, created: false } : await ensureFragmentFile(document.uri, id);
			const targetEditor = await showFragmentWithoutExplorerReveal(creation.uri, !creation.created);
			if (creation.created && targetEditor) {
				const contentStart = findContentStartLine(targetEditor.document);
				const placeOn = Math.min(Math.max(0, contentStart), targetEditor.document.lineCount - 1);
				const pos = new vscode.Position(placeOn, 0);
				targetEditor.selection = new vscode.Selection(pos, pos);
				targetEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			}
			// Inline bracket preview removed; pills are refreshed separately
			return;
		}
		if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
			editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
		}
		await handlePotentialMarker(document, targetLine, editor!);
	});

	const newSetCmd = vscode.commands.registerCommand('codemeta.newSet', async () => {
		const name = await vscode.window.showInputBox({
			prompt: 'Enter a name for the new fragment set (folder under cms/)',
			placeHolder: 'e.g. sprint-12 or notes',
			validateInput: (val) => {
				const trimmed = (val || '').trim();
				if (!trimmed) return 'Set name cannot be empty';
				if (/[\\/]/.test(trimmed)) return 'Slashes are not allowed';
				return undefined;
			}
		});
		if (!name) {
			return;
		}
		const sanitized = name.trim().replace(/\s+/g, '-');
		try {
			await ensureSetFolderExists(sanitized);
			activeSet = sanitized;
			await context.workspaceState.update('codemeta.activeSet', activeSet);
			vscode.window.showInformationMessage(`CodeMeta: Active set switched to "${activeSet}"`);
			await refreshPills();
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeMeta: Failed to create/switch set: ${err?.message || String(err)}`);
		}
	});

	const switchSetCmd = vscode.commands.registerCommand('codemeta.switchSet', async () => {
		try {
			const picks = await listAvailableSets();
			const picked = await vscode.window.showQuickPick(picks, {
				placeHolder: 'Select active fragment set'
			});
			if (!picked) return;
			if (picked === activeSet) return;
			await ensureSetFolderExists(picked);
			activeSet = picked;
			await context.workspaceState.update('codemeta.activeSet', activeSet);
			vscode.window.showInformationMessage(`CodeMeta: Active set switched to "${activeSet}"`);
			await refreshPills();
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeMeta: Failed to switch set: ${err?.message || String(err)}`);
		}
	});

	const summarizeCmd = vscode.commands.registerCommand('codemeta.summarizeSet', async () => {
		try {
			await summarizeCurrentSet();
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeMeta: Failed to summarize set: ${err?.message || String(err)}`);
		}
	});

	const summarizeTxtCmd = vscode.commands.registerCommand('codemeta.summarizeSetTxt', async () => {
		try {
			await summarizeCurrentSetTxt();
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeMeta: Failed to summarize set (txt): ${err?.message || String(err)}`);
		}
	});

	// No CodeLens – we only show the pill decoration and a clickable link on the marker text
	const linkProvider = new CmLinkProvider();
	const linkReg1 = vscode.languages.registerDocumentLinkProvider({ scheme: 'file' }, linkProvider);
	const linkReg2 = vscode.languages.registerDocumentLinkProvider({ scheme: 'untitled' }, linkProvider);

	let categoryDecorations = buildCategoryDecorations();
	for (const dec of categoryDecorations.values()) {
		context.subscriptions.push(dec);
	}

	async function refreshPills(): Promise<void> {
		for (const ed of vscode.window.visibleTextEditors) {
			const perCategory: Record<string, CmItem[]> = {};
			const doc = ed.document;
			for (let i = 0; i < doc.lineCount; i++) {
				const line = doc.lineAt(i);
				const markerInfo = findMarker(line.text);
				if (!markerInfo) continue;
				const after = line.text.slice(markerInfo.markerEnd);
				const id = extractIdAfterMarkerText(after);
				if (!id) continue; // only show pill when an ID exists
				const { preview, categoryLabel, inline } = await getFragmentPreviewAndCategory(doc.uri, id);
				const range = new vscode.Range(i, 0, i, 0);
				const opts: CmItem = { range };
				if (preview) {
					opts.hoverMessage = new vscode.MarkdownString(preview);
				}
				opts.inline = inline || undefined;
				(perCategory[categoryLabel] ||= []).push(opts);
			}
			// Apply decorations per category
			const labels = new Set(Object.keys(perCategory));
			const decMap = categoryDecorations;
			// Ensure unknown categories get a default decoration
			for (const label of labels) {
				if (!decMap.has(label)) {
					// create on-the-fly decoration for unknown labels using default style
					const defStyle = getDefaultCategoryStyle();
					const dec = vscode.window.createTextEditorDecorationType({
						isWholeLine: false,
						before: {
							contentText: `${labelPrefix}${label}:`,
							color: defStyle.foreground,
							backgroundColor: defStyle.background,
							margin: '0 0.6em 0 0',
							fontWeight: '600',
							textDecoration: PILL_TEXT_DECORATION
						}
					});
					categoryDecorations.set(label, dec);
					context.subscriptions.push(dec);
				}
			}
			for (const [label, dec] of categoryDecorations) {
				const items: CmItem[] = perCategory[label] || [];
				// Attach contentText per instance
				const withContent: vscode.DecorationOptions[] = items.map((it) => ({
					range: it.range,
					hoverMessage: it.hoverMessage,
					renderOptions: { before: { contentText: `${labelPrefix}${label}:${it.inline ? ' ' + it.inline : ''}` } }
				}));
				ed.setDecorations(dec, withContent);
			}
		}
	}

	const refreshOnActive = vscode.window.onDidChangeActiveTextEditor(() => { refreshPills(); });
	const refreshOnConfig = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('codemeta.categoryStyles') || e.affectsConfiguration('codemeta.defaultCategory')) {
			// dispose existing
			for (const dec of categoryDecorations.values()) dec.dispose();
			categoryDecorations = buildCategoryDecorations();
			for (const dec of categoryDecorations.values()) context.subscriptions.push(dec);
			refreshPills();
		}
	});

	debouncedRefresh = debounce(refreshPills, 150);

	context.subscriptions.push(createFragmentCmd, changeListener, openFragmentCmd, newSetCmd, switchSetCmd, summarizeCmd, summarizeTxtCmd, linkReg1, linkReg2, refreshOnActive, refreshOnConfig);

	// Initial render
	refreshPills();
}

export function deactivate(): void {
}

async function handlePotentialMarker(document: vscode.TextDocument, lineNumber: number, editor: vscode.TextEditor): Promise<void> {
	const line = document.lineAt(lineNumber);
	const text = line.text;

	const markerInfo = findMarker(text);
	if (!markerInfo) {
		return;
	}

	const { markerStart, markerEnd } = markerInfo;

	const afterMarker = text.slice(markerEnd);
	const existingId = extractIdAfterMarkerText(afterMarker);
	if (existingId) {
		return;
	}

	const idLen = vscode.workspace.getConfiguration('codemeta').get<number>('idLength', 10);
	const id = generateId(Math.max(ID_MIN, Math.min(ID_MAX, idLen || 10)));

	const insertPos = new vscode.Position(lineNumber, markerEnd);

	try {
		isApplyingEdit = true;
		await editor.edit((editBuilder) => {
			editBuilder.insert(insertPos, ` ${id}`);
		}, { undoStopBefore: false, undoStopAfter: false });
	} finally {
		isApplyingEdit = false;
	}

	const creation = await ensureFragmentFile(document.uri, id);

	const targetEditor = await showFragmentWithoutExplorerReveal(creation.uri, !creation.created);
	if (creation.created && targetEditor) {
		const contentStart = findContentStartLine(targetEditor.document);
		const placeOn = Math.min(Math.max(0, contentStart), targetEditor.document.lineCount - 1);
		const pos = new vscode.Position(placeOn, 0);
		targetEditor.selection = new vscode.Selection(pos, pos);
		targetEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}
	// Inline bracket preview removed; pills refresh will handle showing preview inside pill
}

function findMarker(lineText: string): { markerStart: number; markerEnd: number } | null {
	// Detect markers anywhere in the line, regardless of trailing content (IDs, spaces, etc.)
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

function generateId(length: number): string {
	let s = '';
	while (s.length < length) {
		s += Math.floor(Math.random() * 10).toString();
	}
	return s.slice(0, length);
}

async function ensureFragmentFile(sourceUri: vscode.Uri, id: string): Promise<{ uri: vscode.Uri; created: boolean }> {
	const folder = vscode.workspace.getWorkspaceFolder(sourceUri) || vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder');
	}
	const cmsFolderName = vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', 'cms');
	const cmsFolder = vscode.Uri.joinPath(folder.uri, cmsFolderName);
	await vscode.workspace.fs.createDirectory(cmsFolder);
	const setFolder = vscode.Uri.joinPath(cmsFolder, activeSet || 'default');
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

async function getFragmentPreviewAndCategory(sourceUri: vscode.Uri, id: string): Promise<{ preview: string | null; categoryLabel: string; inline: string | null }> {
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

function stripFrontmatter(text: string): string {
	if (text.startsWith('---')) {
		const closeIdx = text.indexOf('\n---', 3);
		if (closeIdx !== -1) {
			const after = text.slice(closeIdx + 4);
			return after.replace(/^\r?\n/, '');
		}
	}
	return text;
}

function parseFrontmatterAndCategory(text: string): { body: string; category?: string } {
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

function truncateLines(text: string, maxLines: number, maxChars: number): string {
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

async function showFragmentWithoutExplorerReveal(uri: vscode.Uri, preserveFocus: boolean): Promise<vscode.TextEditor | undefined> {
	const explorerConfig = vscode.workspace.getConfiguration('explorer');
	const original = explorerConfig.get<boolean>('autoReveal');
	try {
		if (original !== false) {
			await explorerConfig.update('autoReveal', false, vscode.ConfigurationTarget.Workspace);
		}
		return await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus });
	} catch {
		// ignore update errors, still try to open
		return await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus });
	} finally {
		try {
			if (original !== false) {
				await explorerConfig.update('autoReveal', original, vscode.ConfigurationTarget.Workspace);
			}
		} catch {
			// ignore restore errors
		}
	}
}

function findContentStartLine(document: vscode.TextDocument): number {
	// After frontmatter '---' ... '---', content starts either on next line or at top if no frontmatter
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

class CmLinkProvider implements vscode.DocumentLinkProvider {
	provideDocumentLinks(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.DocumentLink[]> {
		const links: vscode.DocumentLink[] = [];
		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			const markerInfo = findMarker(line.text);
			if (!markerInfo) continue;
			const range = new vscode.Range(i, markerInfo.markerStart, i, markerInfo.markerEnd);
			const target = vscode.Uri.parse(`command:codemeta.openFragmentAtLine?${encodeURIComponent(JSON.stringify([document.uri.toString(), i]))}`);
			const link = new vscode.DocumentLink(range, target);
			// Add a clearer tooltip instead of the default "Execute command (Ctrl+Click)"
			const after = line.text.slice(markerInfo.markerEnd);
			const id = extractIdAfterMarkerText(after) || undefined;
			link.tooltip = id ? `Open fragment ${id}` : 'Open fragment';
			links.push(link);
		}
		return links;
	}
}

async function ensureSetFolderExists(setName: string): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) return;
	const cmsFolderName = vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', 'cms');
	const cmsFolder = vscode.Uri.joinPath(folder.uri, cmsFolderName);
	const setFolder = vscode.Uri.joinPath(cmsFolder, setName || 'default');
	await vscode.workspace.fs.createDirectory(setFolder);
}

async function listAvailableSets(): Promise<string[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) return ['default'];
	const cmsFolderName = vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', 'cms');
	const cmsFolder = vscode.Uri.joinPath(folder.uri, cmsFolderName);
	try {
		await vscode.workspace.fs.createDirectory(cmsFolder);
		const entries = await vscode.workspace.fs.readDirectory(cmsFolder);
		const dirs = entries
			.filter(([_, type]) => type === vscode.FileType.Directory)
			.map(([name]) => name)
			.filter(Boolean);
		if (!dirs.includes('default')) dirs.unshift('default');
		// Put current active set on top
		const uniq = Array.from(new Set([activeSet || 'default', ...dirs]));
		return uniq;
	} catch {
		return [activeSet || 'default', 'default'];
	}
}

async function findAnyFragmentUri(sourceUri: vscode.Uri, id: string): Promise<vscode.Uri | null> {
	const folder = vscode.workspace.getWorkspaceFolder(sourceUri) || vscode.workspace.workspaceFolders?.[0];
	if (!folder) return null;
	const cmsFolderName = vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', 'cms');
	const cmsFolder = vscode.Uri.joinPath(folder.uri, cmsFolderName);
	try {
		await vscode.workspace.fs.createDirectory(cmsFolder);
	} catch {
		// ignore
	}
	// 1) Check root cms for backward compatibility
	const rootCandidate = vscode.Uri.joinPath(cmsFolder, `${id}.md`);
	try {
		await vscode.workspace.fs.stat(rootCandidate);
		return rootCandidate;
	} catch { }
	// 2) Check all subdirectories (sets)
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

// Inline bracket preview removed

function buildCategoryDecorations(): Map<string, vscode.TextEditorDecorationType> {
	const styles = vscode.workspace.getConfiguration('codemeta').get<any[]>('categoryStyles', []);
	const map = new Map<string, vscode.TextEditorDecorationType>();
	for (const style of styles) {
		const label: string = String(style.label || '').trim();
		if (!label) continue;
		const foreground = style.foreground || new vscode.ThemeColor('badge.foreground');
		const background = style.background || new vscode.ThemeColor('badge.background');
		const dec = vscode.window.createTextEditorDecorationType({
			isWholeLine: false,
			before: {
				contentText: `${labelPrefix}${label}:`,
				color: foreground,
				backgroundColor: background,
				margin: '0 0.6em 0 0',
				fontWeight: '600',
				textDecoration: PILL_TEXT_DECORATION
			}
		});
		map.set(label, dec);
	}
	return map;
}

function getDefaultCategoryStyle(): { foreground: string | vscode.ThemeColor; background: string | vscode.ThemeColor } {
	const styles = vscode.workspace.getConfiguration('codemeta').get<any[]>('categoryStyles', []);
	const def = styles.find(s => String(s.label || '').toUpperCase() === 'INFO');
	if (def) return { foreground: def.foreground, background: def.background };
	return { foreground: new vscode.ThemeColor('badge.foreground'), background: new vscode.ThemeColor('badge.background') };
}

async function summarizeCurrentSet(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder');
	}
	const cmsFolderName = vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', 'cms');
	const cmsFolder = vscode.Uri.joinPath(folder.uri, cmsFolderName);
	await vscode.workspace.fs.createDirectory(cmsFolder);
	const setName = activeSet || 'default';
	const setFolder = vscode.Uri.joinPath(cmsFolder, setName);
	await vscode.workspace.fs.createDirectory(setFolder);
	const entries = await vscode.workspace.fs.readDirectory(setFolder);
	const ids: string[] = entries
		.filter(([name, type]) => type === vscode.FileType.File && /^(\d{6,32})\.md$/i.test(name))
		.map(([name]) => name.replace(/\.md$/i, ''));
	const idSet = new Set(ids);

	// Map id -> occurrences
	const occurrences = new Map<string, { uri: vscode.Uri; line: number }[]>();
	for (const id of ids) occurrences.set(id, []);

	// Exclude heavy/irrelevant folders and the cms folder itself
	const exclude = `{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/${cmsFolderName}/**}`;
	const files = await vscode.workspace.findFiles('**/*', exclude);
	for (const uri of files) {
		try {
			const data = await vscode.workspace.fs.readFile(uri);
			const text = Buffer.from(data).toString('utf8');
			const lines = text.split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const markerInfo = findMarker(line);
				if (!markerInfo) continue;
				const after = line.slice(markerInfo.markerEnd);
				const id = extractIdAfterMarkerText(after);
				if (!id || !idSet.has(id)) continue;
				occurrences.get(id)!.push({ uri, line: i + 1 });
			}
		} catch {
			// ignore files that cannot be read
		}
	}

	// Build content
	let out = '';
	out += `# Summary for set: ${setName}\n\n`;
	out += `Generated: ${new Date().toISOString()}\n\n`;
	out += `Total fragments: ${ids.length}\n\n`;
	ids.sort();
	for (const id of ids) {
		let category = 'INFO';
		let body = '';
		let fragUri = vscode.Uri.joinPath(setFolder, `${id}.md`);
		try {
			const data = await vscode.workspace.fs.readFile(fragUri);
			const text = Buffer.from(data).toString('utf8');
			const parsed = parseFrontmatterAndCategory(text);
			if (parsed.category) category = parsed.category;
			body = parsed.body;
		} catch { }
		const fragRel = vscode.workspace.asRelativePath(fragUri);
		const fragAbsPath = fragUri.fsPath.replace(/\\/g, '/');
		const fragLink = encodeURI(`vscode://file/${fragAbsPath}`);
		out += `## ${id} (${category})\n\n`;
		out += `Fragment: [${fragRel}](${fragLink})\n\n`;
		const occs = occurrences.get(id) || [];
		out += `Occurrences (${occs.length}):\n`;
		if (occs.length === 0) {
			out += `- none\n\n`;
		} else {
			for (const occ of occs) {
				const rel = vscode.workspace.asRelativePath(occ.uri);
				const abs = occ.uri.fsPath.replace(/\\/g, '/');
				const link = encodeURI(`vscode://file/${abs}:${occ.line}`);
				out += `- [${rel}:${occ.line}](${link})\n`;
			}
			out += `\n`;
		}
		if (body && body.trim().length > 0) {
			out += `Content:\n\n`;
			out += '```markdown\n';
			out += body.replace(/```/g, '\u200b```');
			out += '\n```\n\n';
		} else {
			out += `Content: (empty)\n\n`;
		}
	}

	const summaryUri = vscode.Uri.joinPath(setFolder, 'SUMMARY.md');
	await vscode.workspace.fs.writeFile(summaryUri, Buffer.from(out, 'utf8'));
	await vscode.window.showTextDocument(summaryUri, { preview: false });
}

async function summarizeCurrentSetTxt(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder');
	}
	const cmsFolderName = vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', 'cms');
	const cmsFolder = vscode.Uri.joinPath(folder.uri, cmsFolderName);
	await vscode.workspace.fs.createDirectory(cmsFolder);
	const setName = activeSet || 'default';
	const setFolder = vscode.Uri.joinPath(cmsFolder, setName);
	await vscode.workspace.fs.createDirectory(setFolder);
	const entries = await vscode.workspace.fs.readDirectory(setFolder);
	const ids: string[] = entries
		.filter(([name, type]) => type === vscode.FileType.File && /^(\d{6,32})\.md$/i.test(name))
		.map(([name]) => name.replace(/\.md$/i, ''));
	const idSet = new Set(ids);

	const occurrences = new Map<string, { uri: vscode.Uri; line: number }[]>();
	for (const id of ids) occurrences.set(id, []);

	const exclude = `{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/${cmsFolderName}/**}`;
	const files = await vscode.workspace.findFiles('**/*', exclude);
	for (const uri of files) {
		try {
			const data = await vscode.workspace.fs.readFile(uri);
			const text = Buffer.from(data).toString('utf8');
			const lines = text.split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const markerInfo = findMarker(line);
				if (!markerInfo) continue;
				const after = line.slice(markerInfo.markerEnd);
				const id = extractIdAfterMarkerText(after);
				if (!id || !idSet.has(id)) continue;
				occurrences.get(id)!.push({ uri, line: i + 1 });
			}
		} catch { }
	}

	function escapeTomlString(value: string): string {
		return value.replace(/\\/g, '\\\\').replace(/\"/g, '\\"');
	}
	function escapeTomlMultiline(value: string): string {
		// Use basic multiline string; escape triple quotes
		return value.replace(/\"\"\"/g, '\\"\\"\\"');
	}

	let out = '';
	out += `set = "${escapeTomlString(setName)}"\n`;
	out += `generated = "${escapeTomlString(new Date().toISOString())}"\n`;
	out += `count = ${ids.length}\n\n`;
	ids.sort();
	for (const id of ids) {
		let category = 'INFO';
		let body = '';
		const fragUri = vscode.Uri.joinPath(setFolder, `${id}.md`);
		try {
			const data = await vscode.workspace.fs.readFile(fragUri);
			const text = Buffer.from(data).toString('utf8');
			const parsed = parseFrontmatterAndCategory(text);
			if (parsed.category) category = parsed.category;
			body = parsed.body;
		} catch { }
		const fragRel = vscode.workspace.asRelativePath(fragUri);

		out += `[[fragments]]\n`;
		out += `id = "${escapeTomlString(id)}"\n`;
		out += `category = "${escapeTomlString(category)}"\n`;
		out += `file = "${escapeTomlString(fragRel)}"\n`;
		out += `content = """${escapeTomlMultiline(body)}"""\n`;
		const occs = occurrences.get(id) || [];
		for (const occ of occs) {
			const rel = vscode.workspace.asRelativePath(occ.uri);
			out += `[[fragments.occurrences]]\n`;
			out += `file = "${escapeTomlString(rel)}"\n`;
			out += `line = ${occ.line}\n`;
		}
		out += `\n`;
	}

	const summaryUri = vscode.Uri.joinPath(setFolder, 'SUMMARY.toml');
	await vscode.workspace.fs.writeFile(summaryUri, Buffer.from(out, 'utf8'));
	await vscode.window.showTextDocument(summaryUri, { preview: false });
}

