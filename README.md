# grist-kanban

A Svelte 5 custom widget for Grist that renders a draggable Kanban board and writes card moves back to the table.

## Development

```bash
npm install
npm run dev
```

Local dev opens a demo board with sample data. The built widget is a static site in `dist/`.

## Build

```bash
npm run check
npm run build
```

## GitHub Pages

This repo is set up to publish from GitHub Actions to the project-site URL:

```text
https://grist-widgets.github.io/kanban/
```

Initialize this checkout as a colocated `jj` workspace:

```bash
jj git init
```

Create the initial revision and the `main` bookmark:

```bash
jj describe -m "Initial kanban widget"
jj bookmark create main -r @
```

Create the GitHub repo and add `origin` with `gh`:

```bash
gh repo create grist-widgets/kanban --public --source=. --remote=origin
```

Push the `main` bookmark to GitHub:

```bash
jj git push --bookmark main
```

Enable GitHub Pages to use workflow-based deployment. The `POST` form works if Pages has never been configured; the `PUT` fallback works if it already exists:

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/grist-widgets/kanban/pages \
  -f build_type=workflow \
  -f source[branch]=main \
  -f source[path]=/ \
|| gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/grist-widgets/kanban/pages \
  -f build_type=workflow \
  -f source[branch]=main \
  -f source[path]=/
```

Trigger a deployment manually if you do not want to wait for the next push:

```bash
gh workflow run pages.yml --repo grist-widgets/kanban --ref main
```

Watch the deployment:

```bash
gh run watch --repo grist-widgets/kanban
```

For later updates, the normal cycle is:

```bash
jj describe -m "Describe your change"
jj bookmark move main --to @
jj git push --bookmark main
```

## Using it in Grist

1. Use this widget URL in Grist:

```text
https://grist-widgets.github.io/kanban/
```

2. Map these fields in the widget configuration:
   - `Title`
   - `Status`
   - `Position` if you want card order within a lane to persist

Optional fields:
- `Description`
- `Assignee`
- `Due`
- `Tags`
- `Accent`
