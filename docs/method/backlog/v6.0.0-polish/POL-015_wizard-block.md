# POL-015: Extract reusable WizardBlock

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown Section 2; V6 System Design

## What
`store-wizard.js` implements a full step-based wizard with text input, selection lists, toggles, and confirmation. The step handling, rendering, and key routing are all custom. This pattern is reusable — future wizards (e.g., vault init, recipient add, key rotation) would duplicate the same state machine.

## Fix
Extract the generic wizard infrastructure into `bin/ui/blocks/wizard-block.js`:
1. Step state machine (current/total, forward/back navigation)
2. Step types: text input, masked input, radio select, toggle, confirmation
3. Rendering: step indicator, body content, navigation hints
4. Key routing: enter to advance, backspace/escape to go back, per-step input handling

`store-wizard.js` becomes a thin wrapper that defines the steps and the store execution logic.

## Files
- `bin/ui/blocks/wizard-block.js` (new — generic wizard infrastructure)
- `bin/ui/store-wizard.js` (refactor to use WizardBlock)

## Effort
Medium
