# @git-stunts/cas — Project Status

**Current release:** `v5.3.1`
**Current branch version:** `v5.3.2`
**Last release:** `2026-03-15`
**Current line:** M16 Capstone shipped in `v5.3.0`; `v5.3.1` fixed repeated-chunk tree emission; `v5.3.2` is the next maintenance/doc/test follow-up in flight.
**Runtimes:** Node.js 22.x, Bun, Deno

---

## Interface Strategy

- **Human CLI/TUI:** the current public operator surface. Existing `git cas ...` commands, Bijou formatting, prompts, dashboards, and `--json` convenience output stay here.
- **Agent CLI:** planned next as `git cas agent`. It will be JSONL-first, non-interactive by default, and independent from Bijou rendering or TTY-only behavior.

---

## Recently Shipped

| Version | Milestone | Highlights |
|---------|-----------|------------|
| `v5.3.1` | Maintenance | Repeated-chunk tree integrity fix; unique chunk tree entries; `git fsck` regression coverage |
| `v5.3.0` | M16 Capstone | Audit remediation, `.casrc`, passphrase-file support, restore guards, `encryptionCount`, lifecycle rename |
| `v5.2.0` | M12 Carousel | Key rotation without re-encrypting data |
| `v5.1.0` | M11 Locksmith | Envelope encryption and recipient management |
| `v5.0.0` | M10 Hydra | Content-defined chunking |
| `v4.0.1` | M8 + M9 | Review hardening, `verify`, `--json`, CLI polish |
| `v4.0.0` | M14 Conduit | Streaming restore, observability, parallel chunk I/O |
| `v3.1.0` | M13 Bijou | Interactive dashboard and animated progress |

---

## Next Up

### M17 — Ledger (`v5.3.2`)

Planning and ops reset:

- Reconcile `ROADMAP.md`, `STATUS.md`, and release messaging
- Add review automation (`CODEOWNERS` or equivalent)
- Document Git tree ordering test conventions
- Define release-prep workflow for changelog/version timing
- Automate test-count injection into release notes or changelog prep
- Add property-based fuzz coverage for envelope encryption

### M18 — Relay (`v5.4.0`)

LLM-native CLI foundation:

- Introduce `git cas agent`
- Define the JSONL protocol envelope and exit codes
- Add machine-facing parity for the current operational command set
- Enforce strict non-interactive input handling

### M19 — Nouveau (`v5.5.0`)

Human UX refresh:

- Upgrade Bijou packages to `3.0.0`
- Move the inspector shell to the v3 `ViewOutput` model
- Split the dashboard into sub-apps
- Add better styling, motion, layout persistence, and richer heatmap/detail rendering

---

## Sequenced Roadmap

| Version | Milestone | Theme |
|---------|-----------|-------|
| `v5.3.2` | M17 Ledger | Planning and ops reset |
| `v5.4.0` | M18 Relay | LLM-native CLI foundation |
| `v5.5.0` | M19 Nouveau | Bijou v3 human UX refresh |
| `v5.6.0` | M20 Sentinel | Vault health and safety |
| `v5.7.0` | M21 Atelier | Vault ergonomics and publishing |
| `v5.8.0` | M22 Cartographer | Repo intelligence and change analysis |
| `v5.9.0` | M23 Courier | Artifact sets and transfer |
| `v5.10.0` | M24 Spectrum | Storage and observability extensibility |
| `v5.11.0` | M25 Bastion | Enterprise key-management research |

---

*Future details: [ROADMAP.md](./ROADMAP.md) | Shipped detail: [COMPLETED_TASKS.md](./COMPLETED_TASKS.md) | Superseded: [GRAVEYARD.md](./GRAVEYARD.md)*
