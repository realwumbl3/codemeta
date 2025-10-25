function css(strings: TemplateStringsArray, ...values: string[]): string {
    return strings.reduce((acc, str, i) => acc + str + (values[i] || ""), "");
}

export const sidePanelStyling = css`
    :root {
        color-scheme: var(--vscode-colorScheme);
    }
    body {
        font-family: var(--vscode-font-family);
        font-size: 13px;
        padding: 12px;
        color: var(--vscode-foreground);
    }
    button {
        margin-right: 6px;
        margin-top: 6px;
        padding: 4px 10px;
        background: var(--vscode-button-secondaryBackground);
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 6px;
        cursor: pointer;
    }
    button:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }
    button:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
    }
    button.primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-button-border, transparent);
    }
    button.primary:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .header {
        font-weight: 600;
        margin-bottom: 8px;
    }
    .row {
        margin: 8px 0;
    }
    .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-weight: 600;
    }
    .list {
        list-style: none;
        padding-left: 0;
        margin: 6px 0 0 0;
    }
    .item {
        position: relative;
        padding: 8px 30px 8px 8px;
        border: 1px solid var(--vscode-contrastActiveBorder, transparent);
        border-radius: 6px;
        margin-bottom: 6px;
        background: var(--vscode-editorWidget-background);
    }
    .item:hover {
        background: var(--vscode-list-hoverBackground);
    }
    .item-header {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .count {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 0 6px;
        border-radius: 999px;
        line-height: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
    }
    .item .meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
    }
    .item .id {
        font-weight: 600;
        color: var(--vscode-foreground);
    }
    .item .cat {
        display: inline-block;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-weight: 600;
    }
    .item .title {
        color: var(--vscode-foreground);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
    }
    .toggle {
        position: absolute;
        right: 6px;
        top: 6px;
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        background: transparent;
        border: none;
        color: var(--vscode-descriptionForeground);
        opacity: 0.8;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, color 120ms ease;
    }
    .toggle:hover {
        opacity: 1;
        color: var(--vscode-foreground);
    }
    .toggle:focus {
        outline: 1px solid var(--vscode-focusBorder);
        border-radius: 3px;
    }
    .toggle svg {
        width: 12px;
        height: 12px;
        pointer-events: none;
    }
    .toggle.expanded {
        transform: rotate(90deg);
    }
    .refs {
        list-style: none;
        padding-left: 18px;
        margin: 6px 0 0 0;
    }
    .ref {
        font-size: 12px;
        color: var(--vscode-foreground);
        margin: 2px 0;
    }
    .ref-link {
        background: transparent;
        border: none;
        color: var(--vscode-textLink-foreground);
        padding: 0;
        cursor: pointer;
    }
    .ref-link:hover {
        text-decoration: underline;
    }
`;
