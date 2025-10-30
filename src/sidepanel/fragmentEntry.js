import { html, LiveList } from "../zyx.js";
import { postMessageAwait } from "./util.js";

export class FragmentEntryItem {
    constructor(app, it) {
        this.app = app;
        this.it = it;
        this.refs = new LiveList([]);
        html`
            <li class="item">
                <div class="item-header">
                    <div class="meta">
                        <span class="id">#${it.id}</span>
                        <span class="cat">${it.category}</span>
                    </div>
                    <button
                        class="open-fragment thin-button"
                        zyx-click=${() => this.app.vscode.postMessage({ type: "openFragment", id: it.id })}
                    >
                        Open</button
                    ><button
                        this="button"
                        class="toggle"
                        aria-label="Toggle references"
                        zyx-click=${this.toggleReferences.bind(this)}
                    >
                        <span class="count" id=${"count-" + it.id}
                            >${String(it.count || 0)} ${it.count > 0 ? "refs" : ""}</span
                        >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path fill="currentColor" d="M6 3l6 5-6 5z" />
                        </svg>
                    </button>
                </div>
                <div class="title">${it.title || "(empty)"}</div>
                <ul this="ref_list" class="refs" style="display:none" zyx-live-list=${{ list: this.refs }}></ul>
            </li>
        `.bind(this);
    }

    async toggleReferences() {
        const expanded = this.button.classList.contains("expanded");
        if (expanded) {
            this.button.classList.remove("expanded");
            this.ref_list.style.display = "none";
            return;
        }
        this.button.classList.add("expanded");
        this.ref_list.style.display = "";
        try {
            const response = await postMessageAwait(
                this.app.vscode,
                { type: "fetchRefs", id: this.it.id },
            );
            this.fillRefs(response.items);
        } catch (_) {
            this.refs.clear();
        }
    }

    fillRefs(refs) {
        this.refs.clear();
        for (const r of refs) {
            this.refs.push(html`<li
                class="ref-link"
                zyx-click=${() => this.app.vscode.postMessage({ type: "openLocation", uri: r.uri, line: r.line })}
            >
                ${r.rel}:${r.line}
            </li>`);
        }
    }
}
