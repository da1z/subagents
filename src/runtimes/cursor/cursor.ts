import { spawn } from "child_process";
import type {
  CursorMessage,
  FunctionToolCall,
  ToolCallEvent,
} from "./cursor-message-types.js";
import {
  AgentRuntime,
  ExecutionResult,
  ProgressHandler,
  RuntimeOptions,
} from "../types.js";

type MessageHandler = (message: CursorMessage) =>
  | {
      progress?: Parameters<ProgressHandler>[0];
      lastCompleteAssistantMessage?: string;
    }
  | undefined
  | void;

const thinkingHandler: MessageHandler = (message: CursorMessage) => {
  if (message.type !== "thinking") return;

  return {
    progress: { message: "thinking..." },
  };
};

const createAssistantMessageHandler = (): MessageHandler => {
  let streamingAssistantMessage = "";
  return (message: CursorMessage) => {
    if (message.type !== "assistant") {
      streamingAssistantMessage = "";
      return;
    }
    if (message.timestamp_ms) {
      streamingAssistantMessage += message.message.content[0].text;
      return {
        progress: {
          message:
            streamingAssistantMessage.split("\n").filter(Boolean).at(-1) ??
            "Processing...",
        },
      };
    } else {
      // message without timestamp_ms is the final message
      return {
        progress: {
          message: message.message.content[0].text,
        },
        lastCompleteAssistantMessage: message.message.content[0].text,
      };
    }
  };
};

const getToolName = (message: ToolCallEvent) => {
  return (
    Object.keys(message.tool_call).find((key) => key !== "function") ??
    (message.tool_call as FunctionToolCall).function?.name ??
    "unknown"
  );
};

const toolCallStartedHandler: MessageHandler = (message: CursorMessage) => {
  if (message.type !== "tool_call" || message.subtype !== "started") return;
  return {
    progress: {
      message: `Calling ${getToolName(message)}`,
      increaseTotal: true,
    },
  };
};

const toolCallCompletedHandler: MessageHandler = (message: CursorMessage) => {
  if (message.type !== "tool_call" || message.subtype !== "completed") return;
  return {
    progress: {
      message: `Completed ${getToolName(message)}`,
      increaseProgress: true,
    },
  };
};

class MessageProcessor {
  private context: {
    lastCompleteAssistantMessage: string;
    seenMessages: Set<string>;
  } = {
    lastCompleteAssistantMessage: "",
    seenMessages: new Set(),
  };

  private handlers: MessageHandler[];

  constructor(private readonly onProgress: ProgressHandler) {
    this.handlers = [
      thinkingHandler,
      createAssistantMessageHandler(),
      toolCallStartedHandler,
      toolCallCompletedHandler,
    ];
  }

  process = (message: CursorMessage) => {
    const messageKey = JSON.stringify(message);
    // for some models cursor sends the same message multiple times, we need to dedup
    if (this.context.seenMessages.has(messageKey)) {
      return;
    }
    this.context.seenMessages.add(messageKey);

    for (const handler of this.handlers) {
      const state = handler(message);
      if (state?.progress) {
        this.onProgress(state.progress);
      }
      if (state?.lastCompleteAssistantMessage) {
        this.context.lastCompleteAssistantMessage =
          state.lastCompleteAssistantMessage;
      }
    }
  };

  getResult = () => {
    return this.context.lastCompleteAssistantMessage;
  };
}

export class CursorAgentRuntime implements AgentRuntime {
  name = "cursor";

  async run(
    prompt: string,
    opts: RuntimeOptions,
    onProgress: ProgressHandler,
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
    let lineBuffer = "";

    const messageProcessor = new MessageProcessor(onProgress);
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
            messageProcessor.process(json);
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

        if (code === 0) {
          resolve({
            content: [
              {
                type: "text",
                text: messageProcessor.getResult(),
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
