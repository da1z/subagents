import { spawn } from "child_process";
import { AgentRuntime, ExecutionResult, RuntimeOptions } from "./types.js";
import type {
  ToolCallPayload,
  ReadToolCall,
  WriteToolCall,
  FunctionToolCall,
} from "./cursor-message-types.js";

// Type guards for tool call payloads
const isReadToolCall = (payload: ToolCallPayload): payload is ReadToolCall =>
  "readToolCall" in payload;

const isWriteToolCall = (payload: ToolCallPayload): payload is WriteToolCall =>
  "writeToolCall" in payload;

const isFunctionToolCall = (
  payload: ToolCallPayload,
): payload is FunctionToolCall => "function" in payload;

export class CursorAgentRuntime implements AgentRuntime {
  name = "cursor";

  async run(
    prompt: string,
    opts: RuntimeOptions,
    onProgress: ({
      message,
    }: {
      message: string;
      increaseProgress?: boolean;
      increaseTotal?: boolean;
    }) => void,
  ): Promise<ExecutionResult> {
    const modelMap: Record<string, string> = {
      auto: "auto",
      smart: "sonnet-4.5",
      fast: "composer-1",
      deep: "opus-4.5-thinking",
    };

    const selectedModel = opts.model
      ? modelMap[opts.model] || modelMap.auto
      : modelMap.auto;

    const args = [
      "agent",
      prompt,
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--model",
      selectedModel,
    ];

    console.error(`[subagents] Command: cursor-agent ${args.join(" ")}`);
    console.error(`[subagents] CWD: ${opts.cwd}`);

    let agentError = "";
    let lastCompleteAssistantMessage = ""; // Final complete assistant message (no timestamp_ms)
    let streamingAssistantMessage = ""; // Accumulated streaming partials
    let lineBuffer = "";
    const seenMessages = new Set<string>(); // Track seen JSON for dedup

    return new Promise((resolve) => {
      const child = spawn("cursor-agent", args, {
        cwd: opts.cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      console.error(`[subagents] Child process spawned with PID: ${child.pid}`);

      if (opts.signal) {
        opts.signal.addEventListener("abort", () => {
          console.error(
            `[subagents] Request cancelled, killing agent 'cursor'`,
          );
          child.kill();
        });
      }

      child.stdout.on("data", (data) => {
        if (opts.signal?.aborted) return;

        lineBuffer += data.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            const messageKey = JSON.stringify(json);
            if (seenMessages.has(messageKey)) {
              continue;
            }
            seenMessages.add(messageKey);

            if (json.type !== "assistant" && json.type !== "result") {
              streamingAssistantMessage = "";
            }

            if (json.type === "assistant") {
              const textContent = json.message.content[0].text;

              if (json.timestamp_ms) {
                streamingAssistantMessage += textContent;
              } else {
                lastCompleteAssistantMessage = textContent;
              }

              // Use streaming message for progress, fall back to complete message
              const displayMessage =
                streamingAssistantMessage || lastCompleteAssistantMessage;
              onProgress({
                message:
                  displayMessage.split("\n").filter(Boolean).at(-1) ??
                  "Processing...",
              });
            }

            if (json.type === "thinking") {
              if (json.subtype === "delta") {
                onProgress({
                  message: json.text.length
                    ? `thinking: ${json.text}`
                    : "thinking...",
                });
              }
            }

            if (json.type === "tool_call") {
              const toolCall = json.tool_call as ToolCallPayload;

              if (json.subtype === "started") {
                let message = "Processing...";
                if (isReadToolCall(toolCall)) {
                  message = `Reading ${toolCall.readToolCall.args.path}`;
                } else if (isWriteToolCall(toolCall)) {
                  message = `Writing to ${toolCall.writeToolCall.args.path}`;
                } else if (isFunctionToolCall(toolCall)) {
                  message = `Calling ${toolCall.function.name}`;
                }
                onProgress({ message, increaseTotal: true });
              } else if (json.subtype === "completed") {
                let message = "Completed";
                if (isReadToolCall(toolCall)) {
                  const result = toolCall.readToolCall.result?.success;
                  message = result
                    ? `Read ${toolCall.readToolCall.args.path} (${result.totalLines} lines)`
                    : `Read ${toolCall.readToolCall.args.path}`;
                } else if (isWriteToolCall(toolCall)) {
                  const result = toolCall.writeToolCall.result?.success;
                  message = result
                    ? `Wrote ${result.linesCreated} lines to ${result.path}`
                    : `Wrote to ${toolCall.writeToolCall.args.path}`;
                } else if (isFunctionToolCall(toolCall)) {
                  message = `${toolCall.function.name} completed`;
                }
                onProgress({ message, increaseProgress: true });
              }
            }
          } catch (e) {
            // If not JSON, ignore or handle error
          }
        }
      });

      child.stderr.on("data", (data) => {
        if (opts.signal?.aborted) return;
        agentError += data.toString();
        console.error(`[subagents] stderr: ${data}`);
      });

      child.on("close", (code) => {
        console.error(`[subagents] Child process closed with code: ${code}`);
        if (opts.signal?.aborted) {
          resolve({
            content: [
              {
                type: "text",
                text: "Task cancelled by user",
              },
            ],
            isError: true,
          });
          return;
        }

        const finalResult =
          lastCompleteAssistantMessage || "Task completed (no output captured)";
        console.error(`[subagents] Final result: ${finalResult}`);
        if (code === 0) {
          resolve({
            content: [
              {
                type: "text",
                text: finalResult,
              },
            ],
          });
        } else {
          resolve({
            content: [
              {
                type: "text",
                text: `Error executing agent (exit code ${code}): ${agentError}`,
              },
            ],
            isError: true,
          });
        }
      });

      child.on("error", (err) => {
        console.error(`[subagents] Child process error: ${err.message}`);
        if (opts.signal?.aborted) return;
        resolve({
          content: [
            {
              type: "text",
              text: `Failed to start agent process: ${err.message}`,
            },
          ],
          isError: true,
        });
      });
    });
  }
}
