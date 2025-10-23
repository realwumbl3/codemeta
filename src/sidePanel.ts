import * as vscode from 'vscode';

import { getActiveSet } from './globals';

export class CodeMetaSidePanelProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;

	constructor(private readonly context: vscode.ExtensionContext) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri]
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(async (msg) => {
			if (msg && typeof msg.command === 'string') {
				try {
					await vscode.commands.executeCommand(msg.command);
				} catch (err: any) {
					vscode.window.showErrorMessage(`CodeMeta: Failed to run command: ${msg.command}: ${err?.message || String(err)}`);
				}
			}
		});
		this.postActiveSet(getActiveSet());
	}

	setActiveSet(name: string): void {
		this.postActiveSet(name);
	}

	private postActiveSet(name: string): void {
		if (this.view) {
			this.view.webview.postMessage({ type: 'activeSet', value: name });
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = this.createNonce();
		const styles = `
			:root { color-scheme: var(--vscode-colorScheme); }
			body { font-family: var(--vscode-font-family); font-size: 13px; padding: 12px; color: var(--vscode-foreground); }
			button { margin-right: 6px; margin-top: 6px; padding: 4px 8px; }
			.header { font-weight: 600; margin-bottom: 8px; }
			.row { margin: 8px 0; }
			.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-weight: 600; }
		`;
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title>CodeMeta</title>
			<style>${styles}</style>
		</head>
		<body>
			<div class="header">CodeMeta</div>
			<div class="row">Active set: <span id="activeSet" class="badge"></span></div>
			<div class="row">
				<button id="btnNew">New Set</button>
				<button id="btnSwitch">Switch Set</button>
			</div>
			<div class="row">
				<button id="btnSummarizeMd">Summarize (Markdown)</button>
				<button id="btnSummarizeToml">Summarize (TOML)</button>
			</div>
			<script nonce="${nonce}">
				const vscode = acquireVsCodeApi();
				document.getElementById('btnNew').addEventListener('click', () => vscode.postMessage({ command: 'codemeta.newSet' }));
				document.getElementById('btnSwitch').addEventListener('click', () => vscode.postMessage({ command: 'codemeta.switchSet' }));
				document.getElementById('btnSummarizeMd').addEventListener('click', () => vscode.postMessage({ command: 'codemeta.summarizeSet' }));
				document.getElementById('btnSummarizeToml').addEventListener('click', () => vscode.postMessage({ command: 'codemeta.summarizeSetTxt' }));
				window.addEventListener('message', event => {
					const msg = event.data;
					if (msg && msg.type === 'activeSet') {
						document.getElementById('activeSet').textContent = String(msg.value || 'default');
					}
				});
			</script>
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


