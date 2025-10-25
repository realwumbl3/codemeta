import * as vscode from 'vscode';

import { getActiveSet } from './globals';
import { getCmsFolderUri, parseFrontmatterAndCategory, findMarker, extractIdAfterMarkerText, getCmsFolderName } from './helper';

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
				await this.postRefs(String(msg.id));
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
			const idSet = new Set(ids);
			// Single-pass scan for occurrence counts
			const counts = new Map<string, number>();
			const exclude = `{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/${getCmsFolderName()}/**}`;
			const files = await vscode.workspace.findFiles('**/*', exclude);
			for (const uri of files) {
				try {
					const data = await vscode.workspace.fs.readFile(uri);
					const text = Buffer.from(data).toString('utf8');
					const lines = text.split(/\r?\n/);
					for (let i = 0; i < lines.length; i++) {
						const lineText = lines[i];
						const markerInfo = findMarker(lineText);
						if (!markerInfo) continue;
						const after = lineText.slice(markerInfo.markerEnd);
						const foundId = extractIdAfterMarkerText(after);
						if (foundId && idSet.has(foundId)) {
							counts.set(foundId, (counts.get(foundId) || 0) + 1);
						}
					}
				} catch { }
			}
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
				} catch { }
				(items as any).push({ id, category, title, count: counts.get(id) || 0 });
			}
			this.view.webview.postMessage({ type: 'list', items });
		} catch {
			this.view.webview.postMessage({ type: 'list', items: [] });
		}
	}
	
//cm[8923196433]
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

//codemeta[0] 
	private async postRefs(id: string): Promise<void> {
		if (!this.view) return;
		try {
			const exclude = `{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/${getCmsFolderName()}/**}`;
			const files = await vscode.workspace.findFiles('**/*', exclude);
			const items: { uri: string; rel: string; line: number }[] = [];
			for (const uri of files) {
				try {
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
							items.push({ uri: uri.toString(), rel: vscode.workspace.asRelativePath(uri), line: i + 1 });
						}
					}
				} catch { }
			}
			this.view!.webview.postMessage({ type: 'refs', id, items });
		} catch {
			this.view!.webview.postMessage({ type: 'refs', id, items: [] });
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
		try {
			const htmlUri = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'sidepanel', 'main.html');
			const data = await vscode.workspace.fs.readFile(htmlUri);
			let html = Buffer.from(data).toString('utf8');
			// Build CSP and resource URIs
			const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' ${webview.cspSource};" />`;
			const zyxFile = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'js', 'zyX.umd.js');
			const zyxUri = webview.asWebviewUri(zyxFile).toString();
			const srcBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src')).toString();
			const srcBase = srcBaseUri.endsWith('/') ? srcBaseUri : srcBaseUri + '/';
			const importMap = JSON.stringify({ imports: { 'codemeta/': srcBase } });
			// Inject CSP, import map, and zyX loader into <head>
			html = html.replace(
				/<head>/i,
				`<head>\n\t${cspMeta}\n\t<script type="importmap" nonce="${nonce}">${importMap}<\/script>\n\t<script src="${zyxUri}" nonce="${nonce}"><\/script>`
			);
			// Add nonce to any inline scripts present in HTML
			html = html.replace(/<script(\s+[^>]*)?>/gi, (m) => {
				if (/nonce=/.test(m)) return m;
				return m.replace('<script', `<script nonce="${nonce}"`);
			});
			return html;
		} catch {
			// Fallback to minimal HTML if file is not found
			const zyxFile = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'js', 'zyX.umd.js');
			const zyxUri = webview.asWebviewUri(zyxFile).toString();
			const srcBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src')).toString();
			const srcBase = srcBaseUri.endsWith('/') ? srcBaseUri : srcBaseUri + '/';
			const importMap = JSON.stringify({ imports: { 'codemeta/': srcBase } });
			return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' ${webview.cspSource};" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>CodeMeta</title>
				<style>body{font-family:var(--vscode-font-family);font-size:13px;padding:12px;color:var(--vscode-foreground);} .header{font-weight:600;margin-bottom:8px;}</style>
				<script type="importmap" nonce="${nonce}">${importMap}<\/script>
				<script src="${zyxUri}" nonce="${nonce}"><\/script>
			</head>
			<body>
				<div class="header">CodeMeta</div>
			</body>
			</html>`;
		}
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


