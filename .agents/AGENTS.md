# Workspace Rules

## Ponytail Enforcement (Level: FULL)

Ponytail is set to **FULL** mode and is **ACTIVE ON EVERY SINGLE USER MESSAGE**.

Rules:
1. **The 7-Rung Ladder runs on every code modification**:
   - Rung 1: Does this need to exist at all? (YAGNI — prune speculative features)
   - Rung 2: Already in this codebase? (Search before building; reuse existing models/utils)
   - Rung 3: Stdlib does it?
   - Rung 4: Native platform feature covers it?
   - Rung 5: Installed dependency solves it?
   - Rung 6: Can it be one line?
   - Rung 7: Minimum code that works cleanly.

2. **Diff Minimization**:
   - Shortest clean working diff wins.
   - Zero unrequested abstractions, zero boilerplate scaffolding, zero redundant config.
   - Root-cause fixes over symptom patches.
