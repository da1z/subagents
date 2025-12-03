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
    onProgress: ProgressHandler,
  ): Promise<ExecutionResult>;
}

export type ProgressHandler = (params: {
  message: string;
  increaseProgress?: boolean;
  increaseTotal?: boolean;
}) => void;
