//cm 5664210353 [Remove this function and move it to uitls.]
function findNotePlaceholderLine(document: any): number {
    for (let i = 0; i < document.lineCount; i++) {
        if (document.lineAt(i).text.includes('<!-- Write your note here -->')) {
            return i;
        }
    }
    return -1;
}

//cm 5664210353 [Remove this function and move it to uitls.]
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

//cm 5664210353 [Remove this function and move it to uitls.]
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



//cm 2423884374

//cm 9887239216 [test?]

//cm 5339121762 [what]

//cm 1269733600


//cm 7596464309 [hello what the heck uwu…]

//cm 5339121762 [what]


//cm 6033748701 [OWO yeah…]

//cm 7620222719


//cm 5339121762 [what]
