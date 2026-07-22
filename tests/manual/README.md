# Manual browser checks

These pages are release checks, not examples and are intentionally omitted from the examples index.

Run the existing development server:

```sh
npm run dev
```

Then open:

- `http://localhost:5173/tests/manual/dynamic-draw-count/`

The dynamic draw-count page runs both the default path and `dynamicDrawCount: false`. It automatically checks pre/post-first-frame creation, active-count visibility, bulk lifecycle changes, colors, capacity growth, stale IDs, and slot mappings. A final 90-frame hold remains visible for manual missing-instance or flicker inspection.

No Playwright or other browser automation is required.
