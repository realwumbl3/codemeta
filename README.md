<div align="center" style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin-bottom: 2em;">
    <img src="./img/bannerJ.jpg"/>
</div>

CodeMeta lets you turn lightweight inline comment markers into linked Markdown fragments stored in your workspace. It adds colorful category "pills" in the editor gutter, auto-inserts numeric IDs, shows inline previews in the pill, and can summarize all fragments in a set. A side panel in the Activity Bar provides quick actions.

### Why

-   **Keep notes next to code** without cluttering files
-   **Linkable, persistent fragments** stored under a workspace `cms/` folder
-   **Skimmable previews** inline and on hover
-   **Organize by sets** (e.g., sprint notes, reviews) and **summarize** them

## Quick start

1. In a code file, type a marker and then a space or underscore right after it:

```js
//codemeta␣   or   //cm␣
```

or for Python/shell:

```py
#codemeta␣   or   #cm␣
```

2. On the space or underscore, CodeMeta will:

-   Replace the marker with a bracketed tag and a numeric ID, e.g. `//codemeta[0]`
-   Create `.cms/<active-set>/<id>.md` with frontmatter
-   Open the fragment beside the source editor
-   Display a category pill on the line with the first fragment line; hover to see more

3. Click the `codemeta` marker or run the command to reopen the fragment any time.

## What gets created

-   File: `.cms/<set>/<id>.md`
-   State: `.cms/state.json` (tracks the next numeric ID)
-   Frontmatter:

```markdown
---
id: 1234567890
created: 2024-01-01T00:00:00.000Z
category: INFO
---

Your content here
```

Change `category` as you like (e.g., `BUG`, `TODO`, `NOTE`) and customize colors via settings.

## Features

-   **Markers**: `//codemeta` and `#codemeta` (preferred). Legacy `//cm` and `#cm` still work and are auto-upgraded on trigger.
-   **Auto-ID**: Sequential numeric IDs persisted in `.cms/state.json`
-   **Pill preview**: first line shown inside the pill (no text inserted into your file)
-   **Hover preview**: pill tooltip shows a multi-line preview
-   **Clickable marker**: Ctrl/Cmd+Click on the marker opens/creates the fragment
-   **Fragment sets**: organize fragments under `.cms/<set>/`; switch sets quickly
-   **Summaries**: generate `SUMMARY.md` and `SUMMARY.toml` for the active set with source occurrences
 -   **Side Panel**: Activity Bar view with quick actions (New/Switch Set, Summarize)

## Commands

-   **CodeMeta: Create Fragment for Line** (`codemeta.createFragment`) — Force-create for the current line if a marker exists
-   **CodeMeta: Open Fragment at Line** (`codemeta.openFragmentAtLine`) — Open or create the fragment at the cursor line
-   **CodeMeta: New Fragment Set** (`codemeta.newSet`) — Create and switch to a new `.cms/<set>`
-   **CodeMeta: Switch Active Fragment Set** (`codemeta.switchSet`) — Switch between sets
-   **CodeMeta: Summarize Current Set (Markdown)** (`codemeta.summarizeSet`) — Writes `.cms/<set>/SUMMARY.md`
-   **CodeMeta: Summarize Current Set (TOML)** (`codemeta.summarizeSetTxt`) — Writes `.cms/<set>/SUMMARY.toml`
-   **CodeMeta: Upgrade Legacy Markers to codemeta[id]** (`codemeta.upgradeLegacyMarkers`) — Convert `//cm 123` or `#cm 123` to `codemeta[123]` across your workspace

## Settings

Add to your workspace `settings.json`:

```json
{
    "codemeta.cmsFolder": ".cms", // Folder at workspace root
    "codemeta.idLength": 10, // Reserved; IDs are sequential and may grow in length
    "codemeta.defaultCategory": "INFO",
    "codemeta.categoryStyles": [
        { "label": "INFO", "foreground": "#0a3069", "background": "#cadbfd" },
        { "label": "BUG", "foreground": "#58151c", "background": "#ffebe9" },
        { "label": "TODO", "foreground": "#302d11", "background": "#fff8c5" },
        { "label": "NOTE", "foreground": "#24292f", "background": "#eaeef2" }
    ]
}
```

Unknown categories are rendered with VS Code badge colors by default.

## Working with sets

-   The active set defaults to `default` and is remembered per workspace
-   Create a new set via "New Fragment Set"; files go to `.cms/<your-set>/`
-   Switch sets with "Switch Active Fragment Set" or via the side panel

## Summaries

Generate an overview of the active set:

-   `SUMMARY.md` includes fragment links, categorized sections, and where each ID appears in your workspace
-   `SUMMARY.toml` is machine-friendly with a `[[fragments]]` table

Example occurrence link format in Markdown: `vscode://file/<abs-path>:<line>` so you can jump directly to code.

## Requirements

-   VS Code `^1.92.0`
-   Works in single- or multi-root workspaces (files are placed under the nearest workspace folder)

## Install (from source)

1. Clone this repo
2. Install deps: `npm i`
3. Build: `npm run compile`
4. Press F5 in VS Code to launch an Extension Development Host

Package a VSIX: `npm run package` (produces a `.vsix` you can install via the Extensions view menu)

## Development

-   Entry: `dist/extension.js` (compiled from `src/extension.ts`)
-   Scripts:
    -   `npm run watch` — incremental TypeScript build
    -   `npm run compile` — one-shot build
    -   `npm run package` — build VSIX with `vsce`

## Tips

-   To create a fragment manually, place the cursor on a line with `//cm` or `#cm` and run "Create Fragment for Line"
-   Edit the first line of a fragment to improve its pill preview
-   Keep your `cms/` directory under version control if you want fragment history

## License

MIT © wumbl3 [github](https://github.com/realwumbl3)
