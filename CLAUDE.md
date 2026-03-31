# mod-settings — Settings Module

## Read First
- **Central rules**: `/home/damon/platform/admin/RULES.md`
- **Architecture**: `/home/damon/platform/admin/ARCHITECTURE.md`
- **Module contract**: `/home/damon/platform/admin/MODULE_CONTRACT_SPEC.md`

## Scope
You are working on the **settings** module only. Do NOT modify files outside this directory.

## Mandatory Workflow — Every Task
1. **Read** the relevant code before changing it
2. **Implement** the change
3. **Test with Playwright** — every task gets a test. Run it. It must pass.
4. **Commit and push** — only after tests pass

**"Done" means tested, committed, and pushed. Not just edited.**

## Git
- Commit to YOUR module repo (mod-settings), NEVER to the platform repo
- Each module has its own GitHub remote at lstgms9/mod-settings

## CSS Containment — NEVER BREAK THESE
- NEVER use `position:absolute; inset:0` or `position:fixed` on your module root element
- Your root element should use `position:relative; width:100%; height:100%`
- NEVER use `width:100vw` or `height:100vh` — escapes containment

## Style
- camelCase for JS
- Keep code compact
- No unnecessary abstractions
