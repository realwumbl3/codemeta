# CodeMeta Concept

A VS Code extension that turns special inline comments into linked, editable Markdown fragments stored in the workspace.

## Summary
- Author types `//cm ` (C/JS-like) or `#cm ` (Python/shell) in a source file.
- On typing the space after the marker, the extension:
  1. Ensures a `./cms/` folder exists at the workspace root.
  2. Generates a unique 10-digit ID and creates `./cms/<id>.md`.
  3. Appends the ID to the comment in-place (e.g., `//cm 1234567890`).
  4. Displays a collapsible sub-editor below that line to edit the new fragment.

## Behavior Details
- Marker tokens: `//cm` and `#cm`.
- Trigger: first space typed immediately after the token (e.g., `//cm␣`).
- ID: 10 numeric digits; collision-resistant within the workspace session.
- File path: `./cms/<id>.md`.
- Default file template:
  ```markdown
  ---
  id: <id>
  created: <ISO-8601 timestamp>
  sourceFile: <relative path>
  sourceLine: <1-based line>
  ---

  # Fragment <id>

  <!-- Write your note here -->
  ```
- Comment mutation: if an ID already exists after the token, do nothing (idempotent).

## Inline Sub-Editor UX
- Collapsible area appears directly below the marker line.
- Shows and edits the contents of `./cms/<id>.md`.
- Basic controls: Collapse/Expand, Open in full editor, Delete fragment, Copy link.
- Collapsed/expanded state persisted per document via `workspaceState`.

## Implementation Outline
- Detection: subscribe to `workspace.onDidChangeTextDocument`, watch for edits that convert `cm` → `cm␣` within comment ranges; use a language map for comment tokens (quick heuristic to start).
- Creation: ensure `cms/` via `workspace.fs.createDirectory`, then write `<id>.md` with the template.
- Comment update: apply a minimal `TextEdit` to append ` <id>` after the token on the same line.
- Inline view:
  - Primary: use an editor inset/webview approach anchored to the target line.
  - Stable fallback: decoration + CodeLens or gutter command to toggle a WebviewView panel that auto-reveals under the line region.
- Navigation: clicking the ID or CodeLens opens the fragment file.

## Settings (future)
- `codemeta.cmsFolder`: string, default `cms`.
- `codemeta.idLength`: number, default `10`.
- `codemeta.inline.enabled`: boolean, default `true`.
- `codemeta.template`: string path to custom fragment template.

## Commands
- `codemeta.createFragment`: force-create a fragment for the current line.
- `codemeta.toggleInline`: collapse/expand the inline sub-editor at cursor.
- `codemeta.openFragment`: open a fragment by ID.

## Edge Cases
- Inside strings: avoid triggering if token is not within a comment.
- Repeated triggers: if a 10-digit number follows, skip creation.
- Multi-root: place `cms/` under the file's nearest workspace folder.
- VCS: recommend versioning `cms/` (or allow opting out via `.gitignore`).

## Acceptance Criteria
- Typing `//cm␣` or `#cm␣` appends a 10-digit ID and creates `./cms/<id>.md`.
- The fragment appears in a collapsible inline editor below the comment line (or fallback panel) and is editable.
- State (collapsed/expanded) persists when reopening the document.
- Clicking the ID navigates to the fragment file.
