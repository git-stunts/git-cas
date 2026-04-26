# Cool Idea: Segmented control for manifest detail views

## What
Add a Mantine-style segmented control in the detail pane header to toggle between accordion view, flat text view, and asset card summary. Currently the accordion is the only view mode.

## Why
Different inspection tasks need different views. A flat dump is faster for copy-paste. The asset card is better for quick scanning. The accordion is best for drill-down. Let the user choose.

## Sketch
Use bijou's `badge()` row as a visual mode selector:
`[ACCORDION]  [FLAT]  [CARD]`
Tab or number keys to switch modes.
