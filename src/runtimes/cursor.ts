
import { spawn } from "child_process";
import { AgentRuntime, ExecutionResult, RuntimeOptions } from "./types.js";

export class CursorAgentRuntime implements AgentRuntime {
    name = "cursor";

    async run(
        prompt: string,
        opts: RuntimeOptions,
        onProgress: (message: string) => void
    ): Promise<ExecutionResult> {
        const modelMap: Record<string, string> = {
            auto: "auto",
            smart: "sonnet-4.5",
            fast: "composer-1",
            deep: "gpt-5.1-codex-high",
        };

        const selectedModel = opts.model ? modelMap[opts.model] || modelMap.auto : modelMap.auto;

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
        let comulatedAssistantMessage = "";
        let toolCalls = 0;

        return new Promise((resolve) => {
            const child = spawn("cursor-agent", args, {
                cwd: opts.cwd,
                env: { ...process.env },
                stdio: ["ignore", "pipe", "pipe"],
            });

            console.error(`[subagents] Child process spawned with PID: ${child.pid}`);

            if (opts.signal) {
                opts.signal.addEventListener("abort", () => {
                    console.error(`[subagents] Request cancelled, killing agent 'cursor'`);
                    child.kill();
                });
            }

            child.stdout.on("data", (data) => {
                if (opts.signal?.aborted) return;
                const lines = data.toString().split("\n");
                for (const line of lines) {
                    if (!line.trim()) continue;
                    // console.error("[subagents] Processing line...", line); // verbose logging
                    try {
                        const json = JSON.parse(line);
                        if (json.type !== "assistant" && json.type !== "result") {
                            comulatedAssistantMessage = "";
                        }

                        if (json.type === "assistant") {
                            comulatedAssistantMessage += json.message.content[0].text;
                            onProgress(
                                comulatedAssistantMessage
                                    .split("\n")
                                    .filter(Boolean)
                                    .at(-1) ?? "Processing..."
                            );
                        }

                        if (json.type === "thinking") {
                            if (json.subtype === "delta") {
                                onProgress(
                                    json.text.length ? `thinking: ${json.text}` : "thinking..."
                                );
                            }
                        }

                        if (json.type === "tool_call") {
                            const toolName = Object.keys(json.tool_call)[0];
                            if (json.subtype === "started") {
                                toolCalls++;
                                onProgress(
                                    `Calling ${toolName} with args: ${JSON.stringify(
                                        json.tool_call[toolName].args
                                    )}`
                                );
                            } else if (json.subtype === "completed") {
                                onProgress(`Tool ${toolName} completed`);
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
                    comulatedAssistantMessage || "Task completed (no output captured)";
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
