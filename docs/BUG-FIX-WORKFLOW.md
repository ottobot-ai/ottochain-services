# Bug Fix Workflow

Bug fixes follow a streamlined process compared to features. They skip the full TDD pipeline but still require quality gates.

## Process

### 1. Issue Creation
Every bug needs a GitHub Issue with:
- **Title:** `bug: <clear description>`
- **Repro steps:** How to trigger the bug
- **Expected vs Actual:** What should happen vs what happens
- **Labels:** `bug` + `priority:high|medium|low`

### 2. Root Cause Analysis (REQUIRED)
Before writing ANY code:
- Investigate the actual cause
- Document findings in the issue
- Get confirmation if diagnosis is uncertain

**Why?** Misdiagnosis leads to wasted PRs (see issue #109 history).

### 3. Implementation
- Branch: `fix/<issue-number>-<short-description>`
- Fix the bug
- Add regression test proving the fix works
- Keep changes minimal and focused

### 4. Pull Request
PR must include:
- Link to issue: `Fixes #<issue-number>`
- Root cause explanation
- How the fix addresses it
- Test proving it's fixed

### 5. Review & Merge
- CI must pass
- Code review (can be expedited for critical bugs)
- Merge and close issue

## Priority Levels

| Priority | Response Time | Examples |
|----------|--------------|----------|
| `priority:high` | Same day | Production down, data corruption |
| `priority:medium` | This week | Feature broken, bad UX |
| `priority:low` | When convenient | Edge cases, cosmetic issues |

## Owner

**CodeBot 🔍** monitors bug issues and handles fixes:
- Triages new bug issues
- Performs root cause analysis
- Implements fix + regression test
- Creates PR for review

## Anti-Patterns

❌ Guessing at root cause and writing fix immediately  
❌ Large PRs that "fix" multiple things  
❌ Fixes without regression tests  
❌ Misdiagnosing symptoms as root cause  

✅ Investigate first, code second  
✅ One bug = one PR  
✅ Always add a test  
✅ Explain the "why" in the PR  
