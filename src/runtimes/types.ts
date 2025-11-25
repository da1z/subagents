export interface RuntimeOptions {
  model?: string;
  cwd: string;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [x: string]: unknown;
}

export interface AgentRuntime {
  name: string;
  run(
    prompt: string,
    opts: RuntimeOptions,
    onProgress: ({
      message,
    }: {
      message: string;
      increaseProgress?: boolean;
      increaseTotal?: boolean;
    }) => void,
  ): Promise<ExecutionResult>;
}
