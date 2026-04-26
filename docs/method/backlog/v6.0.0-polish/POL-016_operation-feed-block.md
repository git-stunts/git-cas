# POL-016: Extract OperationFeed block

## Source
Bijou BigBro Audit (2026-04-26) — Main Audit Section 2, Block 3

## What
The dashboard uses a toast system for transient feedback (store success, errors). The audit proposes a richer "OperationFeed" that handles both:
- Transient toasts (current behavior)
- Persistent operation log (store/restore history with progress tracking)

Every store/restore should spawn a scoped progress indicator within the feed, replacing the current "fire and forget" toast pattern.

## Fix
Create `bin/ui/blocks/operation-feed.js`:
1. Wraps the existing notification system
2. Adds a persistent operation history (last N operations with status/duration)
3. Active operations show inline progress (chunk count, bytes transferred)
4. Accessible via a keybinding (e.g., `o` for operations) as a drawer or overlay

## Files
- `bin/ui/blocks/operation-feed.js` (new)
- `bin/ui/dashboard.js` (operation state tracking, keybinding)
- `bin/ui/dashboard-view.js` (render feed overlay)

## Effort
Large
