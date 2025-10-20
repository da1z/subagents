
import { AgentRuntime } from "./types.js";
import { CursorAgentRuntime } from "./cursor.js";

export * from "./types.js";
export * from "./cursor.js";

const runtimes: Record<string, AgentRuntime> = {
    cursor: new CursorAgentRuntime(),
};

export function getRuntime(name: string): AgentRuntime {
    return runtimes[name] ?? runtimes.cursor;
}
