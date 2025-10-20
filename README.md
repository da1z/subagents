# Subagents MCP for Cursor

This MCP server brings **subagents** to Cursor. It allows you to delegate complex, multi-step tasks to specialized agents.

## Features

- **Subagents in Cursor**: Enables agentic workflows directly within Cursor.
- **Default Subagents**: Includes two powerful agents inspired by Claude Code:
  - **General Purpose**: For researching complex questions and executing multi-step tasks.
  - **Explore**: Specialized for quickly finding files and understanding codebase architecture.
- **Automatic Discovery**: Automatically detects and uses your existing Claude subagents from `.claude/agents/`.

> [!WARNING]
> Subagents will have access to all available tools. The `cursor-agent` CLI does not currently support configuring available tools, so the `tool` field in Claude subagent Markdown files will be ignored.

## Prerequisites

- **Cursor CLI**: You must have the [Cursor CLI](https://cursor.com/cli) installed.
- **Node.js**: Version 22.0.0 or higher.

## Usage

Add the following to your `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "subagents": {
      "command": "npx",
      "args": ["-y", "@da1z/subagents", "--cwd", "${workspaceFolder}"]
    }
  }
}
```

_Note: The `--cwd` argument is required._

## Capabilities

This MCP server provides a single tool to the agent:

- **task**: Launches a specialized subagent to handle a complex task. The agent can choose which subagent to use (e.g., "general-purpose", "explore") based on the task requirements.
