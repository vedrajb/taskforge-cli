# TaskForge CLI

TaskForge is a Phase-1 TypeScript/Ink scaffold for a local orchestration CLI.

## Commands

```powershell
npm install
npm run build
npm run dev
```

The CLI entrypoint is `tfg` after the package is built or linked.

## Configuration

The default configuration file is `taskforge.config.jsonc`, with comments supported for hand editing. Startup validates the config and checks that the configured target working directory is inside a Git repository.

Phase 1 intentionally leaves agent flag validation and workflow execution for later phases.
