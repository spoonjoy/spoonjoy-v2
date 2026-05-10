# Coding Task Template (TDD)

## Task: [TITLE]
**Backlog ID**: [SJ-XXX]
**Type**: coding
**Created**: [DATE]
**Status**: [not-started | spec-writing | spec-complete | implementing | testing | done]

---

## Objective
[1-2 sentence description of what this task accomplishes]

## Context
[Links to relevant files, docs, or prior work]
- `BACKLOG.md` item [SJ-XXX]

---

## TDD Workflow

### Phase 1: Spec (Test Suite)

Write the full test suite FIRST. This is your contract/specification.

**Files to create/modify:**
- [ ] `test/[path]/[feature].test.ts`

**Test coverage requirements:**
- [ ] Happy path scenarios
- [ ] Edge cases
- [ ] Error handling
- [ ] Input validation

**Run tests (must FAIL):**
```bash
pnpm test -- --run [test-file-pattern]
```

Expected: All new tests fail (no implementation yet)

---

### Phase 2: Implementation

Only begin after spec is complete and tests fail as expected.

**Files to create/modify:**
- [ ] [list implementation files]

**Implementation checklist:**
- [ ] [atomic work item 1]
- [ ] [atomic work item 2]
- [ ] ...

**Constraints:**
- Do NOT modify tests during implementation
- If tests seem wrong, pause and discuss

---

### Phase 3: Verification

**Run full test suite:**
```bash
pnpm run test:coverage
```

**Acceptance criteria:**
- [ ] All new tests pass
- [ ] No regressions in existing tests
- [ ] Coverage is 100% for statements, branches, functions, and lines
- [ ] No new warnings (eslint, type errors)

---

## Progress Log

### [DATE] - [STATUS]
[What was done, blockers, next step]

---

## Completion

When done:
1. Update `BACKLOG.md` status/notes for the relevant `SJ-*` item
2. Move summary to COMPLETED.md
3. Archive or delete this task from ACTIVE.md
4. Notify:
```bash
clawdbot gateway wake --text "Done: [summary]" --mode now
```
