#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs/promises";
import os from "os";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { z } from "zod";
import { getRuntime } from "./runtimes/index.js";

const argv = yargs(hideBin(process.argv))
  .options({
    cwd: {
      type: "string",
      description: "The current working directory",
      demandOption: "The current working directory is required.",
    },
  })
  .parseSync();

const CWD = argv.cwd;

interface SubAgent {
  name: string;
  whenToUse: string;
  path: string;
  model?: "smart" | "fast" | "deep";
  systemPrompt?: string;
}

async function discoverAgents(): Promise<SubAgent[]> {
  const agents: SubAgent[] = [
    {
      name: "general-purpose",
      whenToUse:
        "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
      systemPrompt: `You are an agent for another coding agent. Given the user's message, you should use the tools available to complete the task. Do what has been asked; nothing more, nothing less. When you complete the task simply respond with a detailed writeup.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: Use Grep or Glob when you need to search broadly. Use Read when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.
- In your final response always share relevant file names and code snippets. Any file paths you return in your response MUST be absolute. Do NOT use relative paths.
- For clear communication, avoid using emojis.`,
      path: "",
    },
    {
      name: "explore",
      whenToUse:
        'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
      systemPrompt: `You are a file search specialist for coding agent. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail)
- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Communicate your final report directly as a regular message - do NOT attempt to create files

Complete the user's search request efficiently and report your findings clearly.`,
      path: "",
      model: "fast",
    },
  ];
  const seenAgents = new Set<string>();

  // 1. Discover from Repo .claude/agents
  const repoAgentsPath = path.join(CWD, ".claude", "agents");
  await scanForAgents(repoAgentsPath, agents, seenAgents);

  // 2. Discover from User ~/.claude/agents/
  const userAgentsPath = path.join(os.homedir(), ".claude", "agents");
  await scanForAgents(userAgentsPath, agents, seenAgents);

  return agents;
}

async function parseAgentFile(filePath: string): Promise<SubAgent | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");

    // Simple frontmatter parsing
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return null;
    }

    const frontmatter = match[1];
    const body = match[2].trim();

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch) return null;

    return {
      name: nameMatch[1].trim(),
      whenToUse: descMatch
        ? descMatch[1].trim()
        : `Sub-agent: ${nameMatch[1].trim()}`,
      path: filePath,
      systemPrompt: body,
    };
  } catch (error) {
    return null;
  }
}

async function scanForAgents(
  dirPath: string,
  agents: SubAgent[],
  seenAgents: Set<string>,
) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const agentPath = path.join(dirPath, entry.name);
        const agent = await parseAgentFile(agentPath);

        if (agent && !seenAgents.has(agent.name)) {
          agents.push(agent);
          seenAgents.add(agent.name);
        }
      }
    }
  } catch (error) {
    // Directory might not exist, just ignore
  }
}

async function main() {
  const agents = await discoverAgents();
  const agentList = agents
    .map((a) => `- ${a.name}: ${a.whenToUse} (Tools: All)`)
    .join("\n");

  const serverInstructions = `This server provides a suite of specialized autonomous agents designed to handle complex tasks, research, and code exploration.

${agentList}

# Tool usage policy
- When doing file search, prefer to use the Task tool in order to reduce context usage.
- You should proactively use the Task tool with specialized agents when the task at hand matches the agent's description.
- If the user specifies that they want you to run tools "in parallel", you MUST send a single message with multiple tool use content blocks. For example, if you need to launch multiple agents in parallel, send a single message with multiple Task tool calls.
- VERY IMPORTANT: When exploring the codebase to gather context or to answer a question that is not a needle query for a specific file/class/function, it is CRITICAL that you use the Task tool with subagent_type=Explore instead of running search commands directly.

- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.`;

  const server = new McpServer(
    {
      name: "subagents",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: serverInstructions,
    },
  );

  server.registerTool(
    "task",
    {
      description: `Launch a new agent to handle complex, multi-step tasks autonomously. 

The Task tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
${agentList}

When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Glob tool instead of the Task tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Task tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above


Usage notes:
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
- Each agent invocation is stateless. You will not be able to send additional messages to the agent, nor will the agent be able to communicate with you outside of its final report. Therefore, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Task tool use content blocks. For example, if you need to launch both a code-reviewer agent and a test-runner agent in parallel, send a single message with both tool calls.

Example usage:

<example_agent_descriptions>
"code-reviewer": use this agent after you are done writing a signficant piece of code
"greeting-responder": use this agent when to respond to user greetings with a friendly joke
</example_agent_description>

<example>
user: "Please write a function that checks if a number is prime"
assistant: Sure let me write a function that checks if a number is prime
assistant: First let me use the Write tool to write a function that checks if a number is prime
assistant: I'm going to use the Write tool to write the following code:
<code>
function isPrime(n) {
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false
  }
  return true
}
</code>
<commentary>
Since a signficant piece of code was written and the task was completed, now use the code-reviewer agent to review the code
</commentary>
assistant: Now let me use the code-reviewer agent to review the code
assistant: Uses the Task tool to launch the code-reviewer agent 
</example>

<example>
user: "Hello"
<commentary>
Since the user is greeting, use the greeting-responder agent to respond with a friendly joke
</commentary>
assistant: "I'm going to use the Task tool to launch the greeting-responder agent"
</example>`,
      inputSchema: {
        description: z
          .string()
          .describe("A short (3-5 word) description of the task"),
        prompt: z.string().describe("The task for the agent to perform"),
        subagent_type: z
          .string()
          .describe("The type of specialized agent to use for this task"),
        model: z
          .enum(["auto", "smart", "fast", "deep"])
          .optional()
          .describe(
            "The intelligence level of the agent. 'auto' (selects the model best fit for the immediate task), 'smart' (best coding performance + agentic tasks), 'fast' (quickest responses with near-frontier intelligence), or 'deep' (maximum reasoning for complex problems). Defaults to 'auto'.",
          ),
      },
    },
    async (
      { subagent_type, prompt, model, description },
      { sendNotification, _meta, signal },
    ) => {
      const currentAgents = await discoverAgents();
      const agent = currentAgents.find((a) => a.name === subagent_type);

      if (!agent) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Agent '${subagent_type}' not found. Available agents: ${currentAgents
                .map((a) => a.name)
                .join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      let toolCalls = 1;
      let totalCalls = 1;
      const reportProgress = ({
        message,
        increaseProgress = false,
        increaseTotal = false,
      }: {
        message: string;
        increaseProgress?: boolean;
        increaseTotal?: boolean;
      }) => {
        if (!_meta?.progressToken) return;
        sendNotification({
          method: "notifications/progress",
          params: {
            progressToken: _meta.progressToken,
            progress: increaseProgress ? ++toolCalls : toolCalls,
            total: increaseTotal ? ++totalCalls : totalCalls,
            message,
          },
        });
      };

      // Construct the full prompt with system prompt if available
      let fullPrompt = prompt;
      if (agent.systemPrompt) {
        fullPrompt = `System Instruction:
        ${agent.systemPrompt}
        
        User Task:
        ${prompt}`;
      }

      console.error(`[subagents] Executing agent '${subagent_type}'`);
      console.error(
        `[subagents] Full prompt length: ${fullPrompt.length} chars`,
      );

      reportProgress({ message: `${subagent_type}: ${description}` });

      const agentRuntime = getRuntime("cursor");
      return await agentRuntime.run(
        fullPrompt,
        {
          cwd: CWD,
          model: model ?? agent.model ?? "auto",
          signal,
        },
        reportProgress,
      );
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[subagents] MCP server started");
}

main();
