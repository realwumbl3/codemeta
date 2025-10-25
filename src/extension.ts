import * as vscode from 'vscode';
import { CodeMetaSidePanelProvider } from './sidePanel';
import { summarizeSetMarkdown, summarizeSetToml } from './summarize';
import { getActiveSet, setActiveSet, ID_MIN, ID_MAX, labelPrefix, PILL_TEXT_DECORATION } from './globals';
import {
	debounce,
	extractIdAfterMarkerText,
	findMarker,
	allocateNextId,
	getCmsFolderName,
	findContentStartLine,
	ensureSetFolderExists,
	listAvailableSets,
	findAnyFragmentUri,
	ensureFragmentFile,
	showFragmentWithoutExplorerReveal,
	getFragmentPreviewAndCategory
} from './helper';

type CmItem = { range: vscode.Range; hoverMessage?: vscode.MarkdownString; inline?: string };
let isApplyingEdits = false;

export function activate(context: vscode.ExtensionContext): void {
	// Initialize active set from workspace state
	const savedSet = context.workspaceState.get<string>('codemeta.activeSet', 'default');
	const activeSet = (savedSet && savedSet.trim()) ? savedSet : 'default';
	setActiveSet(activeSet);

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

	const sidePanelProvider = new CodeMetaSidePanelProvider(context);
	const sidePanelReg = vscode.window.registerWebviewViewProvider('codemeta.sidePanel', sidePanelProvider, { webviewOptions: { retainContextWhenHidden: true } });
	context.subscriptions.push(sidePanelReg);
	const createFragmentCmd = vscode.commands.registerCommand('codemeta.createFragment', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		await handlePotentialMarker(editor.document, editor.selection.active.line, editor);
	});
	let debouncedRefresh: () => void;

	const changeListener = vscode.workspace.onDidChangeTextDocument(async (e) => {
		if (isApplyingEdits) {
			return;
		}
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.toString() !== e.document.uri.toString()) {
			return;
		}
		// Trigger on space or underscore immediately after the marker
		if (e.contentChanges.length === 1 && (e.contentChanges[0].text === ' ' || e.contentChanges[0].text === '_')) {
			const ch = e.contentChanges[0];
			const ln = ch.range.start.line;
			const pos = ch.range.start.character; // position in pre-change line
			const newLine = e.document.lineAt(ln).text;
			let preLine = newLine;
			if (pos <= newLine.length && newLine.charAt(pos) === ch.text) {
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
			setActiveSet(sanitized);
			await context.workspaceState.update('codemeta.activeSet', sanitized);
			vscode.window.showInformationMessage(`CodeMeta: Active set switched to "${sanitized}"`);
			await refreshPills();
			sidePanelProvider.setActiveSet(sanitized);
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
			if (picked === getActiveSet()) return;
			await ensureSetFolderExists(picked);
			setActiveSet(picked);
			await context.workspaceState.update('codemeta.activeSet', picked);
			vscode.window.showInformationMessage(`CodeMeta: Active set switched to "${picked}"`);
			await refreshPills();
			sidePanelProvider.setActiveSet(picked);
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeMeta: Failed to switch set: ${err?.message || String(err)}`);
		}
	});

	const summarizeCmd = vscode.commands.registerCommand('codemeta.summarizeSet', async () => {
		try {
			await summarizeSetMarkdown();
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeMeta: Failed to summarize set: ${err?.message || String(err)}`);
		}
	});

	const summarizeTxtCmd = vscode.commands.registerCommand('codemeta.summarizeSetTxt', async () => {
		try {
			await summarizeSetToml();
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeMeta: Failed to summarize set (txt): ${err?.message || String(err)}`);
		}
	});

	const upgradeLegacyCmd = vscode.commands.registerCommand('codemeta.upgradeLegacyMarkers', async () => {
		try {
			const exclude = `{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/${getCmsFolderName()}/**}`;
			const files = await vscode.workspace.findFiles('**/*', exclude);
			let changedFiles = 0;
			for (const uri of files) {
				try {
					const data = await vscode.workspace.fs.readFile(uri);
					const text = Buffer.from(data).toString('utf8');
					let updated = text
						.replace(/\/\/cm\s+(\d{1,32})/g, '//codemeta[$1]')
						.replace(/#cm\s+(\d{1,32})/g, '#codemeta[$1]')
						.replace(/\/\/codemeta\s+\[(\d{1,32})\]/g, '//codemeta[$1]')
						.replace(/#codemeta\s+\[(\d{1,32})\]/g, '#codemeta[$1]');
					if (updated !== text) {
						await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
						changedFiles++;
					}
				} catch { /* ignore file */ }
			}
			vscode.window.showInformationMessage(`CodeMeta: Upgraded markers in ${changedFiles} file(s).`);
		} catch (err: any) {
			vscode.window.showErrorMessage(`CodeMeta: Failed to upgrade markers: ${err?.message || String(err)}`);
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

	context.subscriptions.push(createFragmentCmd, changeListener, openFragmentCmd, newSetCmd, switchSetCmd, summarizeCmd, summarizeTxtCmd, upgradeLegacyCmd, linkReg1, linkReg2, refreshOnActive, refreshOnConfig);

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
	const id = await allocateNextId(Math.max(ID_MIN, Math.min(ID_MAX, idLen || 10)));

	const insertPos = new vscode.Position(lineNumber, markerStart);

	try {
		isApplyingEdits = true;
		await editor.edit((editBuilder) => {
			// Replace the marker and any immediate trailing space/underscore with standardized tag
			const end = new vscode.Position(lineNumber, markerEnd);
			const replaceRange = new vscode.Range(insertPos, end);
			const isHash = text.startsWith('#', markerStart);
			const prefix = isHash ? '#codemeta' : '//codemeta';
			editBuilder.replace(replaceRange, `${prefix}[${id}]`);
		}, { undoStopBefore: false, undoStopAfter: false });
	} finally {
		isApplyingEdits = false;
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

