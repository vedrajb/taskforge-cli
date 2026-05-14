# Phase 2: Input Shortcuts

## Goal

Add Codex-style input shortcuts to TaskForge:

- `@path/to/file`: attach a workspace file reference to the current prompt.
- `@path/to/folder`: attach a shallow workspace folder reference to the current prompt.
- `!command`: run a Git Bash command from the current target workspace.

## Planned Files

```text
src/input/parseUserInput.ts
src/input/resolveFileReferences.ts
src/input/runBangCommand.ts
```

## `@` File References

`@` references resolve relative to `target.cwd`.

Rules:

1. Only resolve files and folders inside the configured target workspace.
2. Reject absolute paths unless they resolve inside `target.cwd`.
3. Reject parent traversal that escapes `target.cwd`.
4. For files, include path, size, and text content when the file is reasonably small.
5. For folders, include a shallow listing first. Do not recursively read large folder trees by default.
6. Show unresolved references in the TUI before submitting the prompt.

Resolved references should be passed into agent prompts as labeled structured context. Do not paste file content into the raw user request without path labels.

## `!` Bash Commands

`!` commands run through Git Bash where possible.

Rules:

1. Run from `target.cwd`.
2. Prefer the configured Git Bash shell.
3. Stream stdout and stderr into the TUI.
4. Require confirmation before disruptive commands listed in the project guardrails.
5. Block commands that target paths outside the workspace unless explicitly confirmed.
6. Do not run `!` commands during active agent execution unless the current phase explicitly allows it.

Initial command shape:

```powershell
"C:\Program Files\Git\bin\bash.exe" -lc "<command>"
```

The input parser should produce a structured command request. `runProcess.ts` should be responsible for converting that request into the final process invocation so shell quoting stays centralized.

## Implementation Checklist

1. Add user input parsing for regular text, `@` references, and `!` commands.
2. Add workspace-bound path resolution for `@` references.
3. Add shallow folder summary generation.
4. Add TUI preview for resolved and unresolved references.
5. Add Git Bash command execution for `!` commands.
6. Add high-risk command detection and confirmation prompts.
7. Stream `!` command output through the same TUI log path used for agent output.
