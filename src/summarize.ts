import * as vscode from 'vscode';
import { findMarker, extractIdAfterMarkerText, parseFrontmatterAndCategory } from './helper';
import { getActiveSet } from './globals';

export async function summarizeSetMarkdown(activeSetName?: string): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder');
	}
	const cmsFolderName = vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', 'cms');
	const cmsFolder = vscode.Uri.joinPath(folder.uri, cmsFolderName);
	await vscode.workspace.fs.createDirectory(cmsFolder);
	const setName = activeSetName || getActiveSet() || 'default';
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
		} catch {
			// ignore
		}
	}

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

export async function summarizeSetToml(activeSetName?: string): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('No workspace folder');
	}
	const cmsFolderName = vscode.workspace.getConfiguration('codemeta').get<string>('cmsFolder', 'cms');
	const cmsFolder = vscode.Uri.joinPath(folder.uri, cmsFolderName);
	await vscode.workspace.fs.createDirectory(cmsFolder);
	const setName = activeSetName || getActiveSet() || 'default';
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


