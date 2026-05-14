# CLI Flags — Phase 0 Validation Results

## Claude

- Planning/parity: `claude -p --verbose --output-format stream-json "<prompt>"`
- `--output-format stream-json` requires `--verbose` when used with `-p`; without it the CLI exits with code 1.
- Output is NDJSON: `assistant` events carry streamed text, `result` event carries the final response string.

## Codex

- Planning: `codex exec --skip-git-repo-check -c reasoning_effort="<level>" "<prompt>"`
- Execution: `codex exec -c reasoning_effort="<level>" "<prompt>"`
- Review: `codex exec review --uncommitted`
- `--reasoning-effort` does not exist; reasoning effort is set via `-c reasoning_effort=<level>` (TOML config override).
- `--skip-git-repo-check` is confirmed available.
- `--json` flag exists to emit JSONL events; not used in v1 (plain text output is sufficient).
- `-o <file>` writes the last agent message to a file; not used in v1.
