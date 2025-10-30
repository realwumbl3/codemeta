import { html, LiveList } from "../zyx.js";

import { FragmentEntryItem } from "./fragmentEntry.js";

class App {
    constructor() {
        this.vscode = acquireVsCodeApi();
        this.items = new LiveList([]);
        this.render().appendTo(document.getElementById("app") || document.body);
        window.addEventListener("message", this.onMessage.bind(this));
        // Responsive compaction
        this.handleResize = this.handleResize.bind(this);
        window.addEventListener("resize", this.handleResize);
        this.handleResize();
        this.vscode.postMessage({ type: "fetchList" });
    }

    render() {
        return html`
            <div class="appbar">
                <div class="appbar-left">
                    <div class="app-title">CodeMeta</div>
                    <span class="version-badge">v${window.version} · alpha</span>
                </div>
            </div>
            <div class="toolbar row">
                <div class="button-group">
                    <div class="appbar-right">
                        <span class="label">Active set</span>
                        <span this="activeSet" class="badge"></span>
                    </div>
                    <button
                        class="ghost"
                        title="Create a new set"
                        aria-label="New Set"
                        zyx-click=${() => this.vscode.postMessage({ command: "codemeta.newSet" })}
                    >
                        <span class="btn-label">New</span>
                    </button>
                    <button
                        class="ghost"
                        title="Switch active set"
                        aria-label="Switch Set"
                        zyx-click=${() => this.vscode.postMessage({ command: "codemeta.switchSet" })}
                    >
                        <span class="btn-label">Switch</span>
                    </button>
                </div>
                <div class="spacer"></div>
                <div class="button-group">
                    <span class="label">Summarize set</span>
                    <button
                        class="primary"
                        title="Summarize current set to Markdown"
                        aria-label="Summarize Markdown"
                        zyx-click=${() => this.vscode.postMessage({ command: "codemeta.summarizeSet" })}
                    >
                        <span class="btn-label">Markdown</span>
                    </button>
                    <button
                        class="primary"
                        title="Summarize current set to TOML"
                        aria-label="Summarize TOML"
                        zyx-click=${() => this.vscode.postMessage({ command: "codemeta.summarizeSetTxt" })}
                    >
                        <span class="btn-label">TOML</span>
                    </button>
                </div>
            </div>
            <div class="section">
                <div class="section-header">
                    <div class="section-title">Fragments</div>
                    <button
                        class="ghost"
                        title="Refresh fragment list"
                        aria-label="Refresh"
                        zyx-click=${() => this.vscode.postMessage({ type: "fetchList" })}
                    >
                        <span class="btn-label">Refresh</span>
                    </button>
                </div>
                <ul
                    this="list"
                    class="list"
                    zyx-live-list=${{ list: this.items, compose: (it) => new FragmentEntryItem(this, it) }}
                ></ul>
            </div>
        `.bind(this);
    }

    handleResize() {
        try {
            const host = document.getElementById("app") || document.body;
            const width = host.clientWidth;
            const compact = width <= 420;
            document.body.classList.toggle("compact", compact);
        } catch (_) {}
    }

    onMessage(event) {
        const msg = event.data;
        if (msg && msg.type === "activeSet") {
            this.activeSet.textContent = String(msg.value || "default");
            this.vscode.postMessage({ type: "fetchList" });
        }
        if (msg && msg.type === "list") {
            const arr = Array.isArray(msg.items) ? msg.items : [];
            this.items.clear();
            this.items.push(...arr);
        }
    }
}

new App();
