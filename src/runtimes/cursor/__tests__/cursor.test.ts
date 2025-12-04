import { toolCallCompletedHandler, toolCallStartedHandler } from "../cursor.js";
import type {
  ToolCallStartedEvent,
  ToolCallCompletedEvent,
  ToolCallPayload,
} from "../message-types.js";

const createStartedMessage = (
  toolCall: ToolCallPayload,
): ToolCallStartedEvent => ({
  type: "tool_call",
  subtype: "started",
  call_id: "test-call-id",
  session_id: "test-session-id",
  tool_call: toolCall,
});

const createCompletedMessage = (
  toolCall: ToolCallPayload,
): ToolCallCompletedEvent => ({
  type: "tool_call",
  subtype: "completed",
  call_id: "test-call-id",
  session_id: "test-session-id",
  tool_call: toolCall,
});

describe("toolCallStartedHandler", () => {
  it("extracts tool name from readToolCall", () => {
    const message = createStartedMessage({
      readToolCall: { args: { path: "test.txt" } },
    });

    expect(toolCallStartedHandler(message)).toEqual({
      progress: { message: "Calling readToolCall", increaseTotal: true },
    });
  });

  it("extracts tool name from function call", () => {
    const message = createStartedMessage({
      function: { name: "myFunction", arguments: "{}" },
    });

    expect(toolCallStartedHandler(message)).toEqual({
      progress: { message: "Calling myFunction", increaseTotal: true },
    });
  });
});

describe("toolCallCompletedHandler", () => {
  it("extracts tool name from readToolCall", () => {
    const message = createCompletedMessage({
      readToolCall: { args: { path: "test.txt" } },
    });

    expect(toolCallCompletedHandler(message)).toEqual({
      progress: { message: "Completed readToolCall", increaseProgress: true },
    });
  });

  it("extracts tool name from function call", () => {
    const message = createCompletedMessage({
      function: { name: "myFunction", arguments: "{}" },
    });

    expect(toolCallCompletedHandler(message)).toEqual({
      progress: { message: "Completed myFunction", increaseProgress: true },
    });
  });
});
