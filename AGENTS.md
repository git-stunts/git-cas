# AGENTS

This guide is for AI agents and human operators recovering context in the
`git-cas` repository.

## Git Rules

- **NEVER** amend commits.
- **NEVER** rebase or force-push.
- **NEVER** push to `main` without explicit permission.
- Always use standard commits and regular pushes.

## Documentation & Planning Map

Do not audit the repository by recursively walking the filesystem. Follow the
authoritative manifests:

### 1. The Entrance

- **`README.md`**: Public front door, core value prop, and quick start.
- **`GUIDE.md`**: Orientation and productive-fast path.
- **`docs/WALKTHROUGH.md`**: Long-form manual and examples.

### 2. The Bedrock

- **`ARCHITECTURE.md`**: The authoritative structural reference (Facade,
  Domain, Ports).
- **`VISION.md`**: Core tenets and project identity.
- **`WORKFLOW.md`** and **`docs/method/process.md`**: Repo work doctrine.

### 3. The Direction

- **`BEARING.md`**: Current execution gravity and active tensions.
- **GitHub Issues and Milestones**: Active source of truth for pending work.
- **`ROADMAP.md`**: Signpost to the GitHub release tracker.
- **`docs/design/`**: Durable design contracts and proof plans.

### 4. The Proof

- **`CHANGELOG.md`**: Historical truth of merged behavior.
- **`STATUS.md`**: Compact snapshot of release and runtime truth.

## Context Recovery Protocol

When starting a new session or recovering from context loss:

1. **Read `BEARING.md`** to find the current execution gravity.
2. **Read `WORKFLOW.md` and `docs/method/process.md`** to understand the work
   doctrine.
3. **Check GitHub Issues and Milestones** for tracked work.
4. **Check `ROADMAP.md`** for release-train orientation.
5. **Check `git log -n 5` and `git status`** to verify the current branch state.

## End of Turn Checklist

After altering files:

1. **Verify Truth**: Ensure documentation is updated if behavior or structure
   changed.
2. **Log Debt**: Add follow-on work as GitHub Issues.
3. **Commit**: Use focused, conventional commit messages.
4. **Validate**: Run `npm test` and `npx eslint .`.

---
**The goal is inevitably. Every feature is defined by its tests.**
