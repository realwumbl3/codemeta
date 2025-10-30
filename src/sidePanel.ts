import * as vscode from 'vscode';

import * as path from 'path';
import { getActiveSet } from './globals';
import { getCmsFolderUri, parseFrontmatterAndCategory, findMarker, extractIdAfterMarkerText, getCmsFolderName, extractRefsLinesFromFrontmatter } from './helper';

export class CodeMetaSidePanelProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;

	constructor(private readonly context: vscode.ExtensionContext) { }

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri]
		};
		webviewView.webview.html = await this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(async (msg) => {
			const reqId = msg && msg._reqId;
			if (msg && typeof msg.command === 'string') {
				try {
					await vscode.commands.executeCommand(msg.command);
				} catch (err: any) {
					vscode.window.showErrorMessage(`CodeMeta: Failed to run command: ${msg.command}: ${err?.message || String(err)}`);
				}
			}
			if (msg && msg.type === 'fetchList') {
				await this.postFragmentList(getActiveSet());
			}
			if (msg && msg.type === 'fetchRefs' && msg.id) {
				await this.postRefs(String(msg.id), reqId);
			}
			if (msg && msg.type === 'openFragment' && msg.id) {
				await this.openFragmentById(String(msg.id));
			}
			if (msg && msg.type === 'openLocation' && msg.uri && typeof msg.line === 'number') {
				await this.openLocation(String(msg.uri), Number(msg.line));
			}
		});
		this.postActiveSet(getActiveSet());
		this.postFragmentList(getActiveSet());
	}

	setActiveSet(name: string): void {
		this.postActiveSet(name);
	}

	private postActiveSet(name: string): void {
		if (this.view) {
			this.view.webview.postMessage({ type: 'activeSet', value: name });
		}
	}

	private async postFragmentList(setName: string): Promise<void> {
		if (!this.view) return;
		try {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				this.view.webview.postMessage({ type: 'list', items: [] });
				return;
			}
			const cmsFolder = getCmsFolderUri(folder);
			await vscode.workspace.fs.createDirectory(cmsFolder);
			const setFolder = vscode.Uri.joinPath(cmsFolder, setName || 'default');
			await vscode.workspace.fs.createDirectory(setFolder);
			const entries = await vscode.workspace.fs.readDirectory(setFolder);
			const ids = entries
				.filter(([name, type]) => type === vscode.FileType.File && /^(\d{1,32})\.md$/i.test(name))
				.map(([name]) => name.replace(/\.md$/i, ''))
				.sort((a, b) => Number(a) - Number(b));
			const counts = new Map<string, number>();
			const items: { id: string; category: string; title: string }[] = [];
			for (const id of ids) {
				const fragUri = vscode.Uri.joinPath(setFolder, `${id}.md`);
				let category = 'INFO';
				let title = '';
				try {
					const data = await vscode.workspace.fs.readFile(fragUri);
					const text = Buffer.from(data).toString('utf8');
					const parsed = parseFrontmatterAndCategory(text);
					if (parsed.category) category = parsed.category;
					const trimmed = parsed.body.trim();
					if (trimmed) {
						const first = trimmed.split(/\r?\n/)[0]?.trim() || '';
						title = first.length > 120 ? first.slice(0, 117) + '…' : first;
					}
					// Count refs from header
					const refs = extractRefsLinesFromFrontmatter(text);
					let sum = 0;
					for (const r of refs) {
						const m = r.match(/^(\d+)@(.+)$/);
						if (m) sum += Number(m[1]) || 0;
					}
					counts.set(id, sum);
				} catch { }
				(items as any).push({ id, category, title, count: counts.get(id) || 0 });
			}
			this.view.webview.postMessage({ type: 'list', items });
		} catch {
			this.view.webview.postMessage({ type: 'list', items: [] });
		}
	}

	private async openFragmentById(id: string): Promise<void> {
		try {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) return;
			const cmsFolder = getCmsFolderUri(folder);
			const setFolder = vscode.Uri.joinPath(cmsFolder, getActiveSet() || 'default');
			const uri = vscode.Uri.joinPath(setFolder, `${id}.md`);
			await vscode.window.showTextDocument(uri, { preview: false });
		} catch {
			// ignore
		}
	}

	private async postRefs(id: string, reqId: string): Promise<void> {
		if (!this.view) return;
		try {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				this.view!.webview.postMessage({ type: 'refs', id, items: [], _reqId: reqId });
				return;
			}
			const cmsFolder = getCmsFolderUri(folder);
			const setFolder = vscode.Uri.joinPath(cmsFolder, getActiveSet() || 'default');
			const fragUri = vscode.Uri.joinPath(setFolder, `${id}.md`);
			let refs: string[] = [];
			try {
				const data = await vscode.workspace.fs.readFile(fragUri);
				const text = Buffer.from(data).toString('utf8');
				refs = extractRefsLinesFromFrontmatter(text);
			} catch { refs = []; }
			const items: { uri: string; rel: string; line: number }[] = [];
			for (const r of refs) {
				const m = r.match(/^(\d+)@(.+)$/);
				if (!m) continue;
				const rel = m[2];
				try {
					const absFsPath = path.join(folder.uri.fsPath, rel.replace(/[\\/]/g, path.sep));
					const uri = vscode.Uri.file(absFsPath);
					const data = await vscode.workspace.fs.readFile(uri);
					const text = Buffer.from(data).toString('utf8');
					const lines = text.split(/\r?\n/);
					for (let i = 0; i < lines.length; i++) {
						const lineText = lines[i];
						const markerInfo = findMarker(lineText);
						if (!markerInfo) continue;
						const after = lineText.slice(markerInfo.markerEnd);
						const foundId = extractIdAfterMarkerText(after);
						if (foundId === id) {
							items.push({ uri: uri.toString(), rel, line: i + 1 });
						}
					}
				} catch { /* ignore per-file */ }
			}
			this.view!.webview.postMessage({ type: 'refs', id, items, _reqId: reqId });
		} catch {
			this.view!.webview.postMessage({ type: 'refs', id, items: [], _reqId: reqId });
		}
	}

	private async openLocation(uriString: string, line: number): Promise<void> {
		try {
			const uri = vscode.Uri.parse(uriString);
			const doc = await vscode.workspace.openTextDocument(uri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });
			const ln = Math.max(0, Math.min(editor.document.lineCount - 1, line - 1));
			const pos = new vscode.Position(ln, 0);
			editor.selection = new vscode.Selection(pos, pos);
			editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		} catch { }
	}

	private async getHtml(webview: vscode.Webview): Promise<string> {
		const nonce = this.createNonce();
		const mainJsFile = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'sidepanel', 'main.js');
		const mainJsUri = webview.asWebviewUri(mainJsFile).toString();
		const cssFile = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'sidepanel', 'css.css');
		const cssUri = webview.asWebviewUri(cssFile).toString();
		const srcBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src')).toString();
		const srcBase = srcBaseUri.endsWith('/') ? srcBaseUri : srcBaseUri + '/';
		const importMap = JSON.stringify({ imports: { 'codemeta/': srcBase } });
		const csp = `default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' ${webview.cspSource};`;
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta http-equiv="Content-Security-Policy" content="${csp}" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title>CodeMeta</title>
			<link rel="stylesheet" href="${cssUri}" />
			<script nonce="${nonce}">window.version = "${this.context.extension.packageJSON.version}";<\/script>
			<script type="importmap" nonce="${nonce}">${importMap}<\/script>
			<script type="module" src="${mainJsUri}" nonce="${nonce}"><\/script>
		</head>
		<body>
			<div id="app"></div>
		</body>
		</html>`;
	}

	private createNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 16; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}


