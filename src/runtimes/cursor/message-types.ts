/**
 * ⚠️  WARNING: This file is vibecoded and not 100% validated.
 * Types are derived from observed behavior and may be incomplete or inaccurate.
 */

export interface TextContent {
  type: "text";
  text: string;
}

export interface Message<Role extends "user" | "assistant"> {
  role: Role;
  content: TextContent[];
}

export interface ReadToolCallArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadRange {
  startLine: number;
  endLine: number;
}

export interface ReadToolCallSuccessResult {
  success: {
    content: string;
    isEmpty: boolean;
    exceededLimit: boolean;
    totalLines: number;
    totalChars?: number;
    fileSize?: number;
    path?: string;
    readRange?: ReadRange;
  };
}

export interface ReadToolCall {
  readToolCall: {
    args: ReadToolCallArgs;
    result?: ReadToolCallSuccessResult;
  };
}

export interface WriteToolCallArgs {
  path: string;
  fileText: string;
  toolCallId: string;
}

export interface WriteToolCallSuccessResult {
  success: {
    path: string;
    linesCreated: number;
    fileSize: number;
  };
}

export interface WriteToolCall {
  writeToolCall: {
    args: WriteToolCallArgs;
    result?: WriteToolCallSuccessResult;
  };
}

export interface EditToolCallArgs {
  path: string;
  streamContent: string;
}

export interface EditToolCallSuccessResult {
  success: {
    path: string;
    linesAdded: number;
    linesRemoved: number;
    diffString: string;
    afterFullFileContent: string;
    message: string;
  };
}

export interface EditToolCall {
  editToolCall: {
    args: EditToolCallArgs;
    result?: EditToolCallSuccessResult;
  };
}

export interface DeleteToolCallArgs {
  path: string;
  toolCallId: string;
}

export interface DeleteToolCallRejectedResult {
  rejected: {
    path: string;
    reason: string;
  };
}

export interface DeleteToolCallSuccessResult {
  success: {
    path: string;
    message?: string;
  };
}

export type DeleteToolCallResult =
  | DeleteToolCallRejectedResult
  | DeleteToolCallSuccessResult;

export interface DeleteToolCall {
  deleteToolCall: {
    args: DeleteToolCallArgs;
    result?: DeleteToolCallResult;
  };
}

export interface SemSearchToolCallArgs {
  query: string;
  targetDirectories: string[];
  explanation: string;
}

export interface SemSearchToolCallSuccessResult {
  success: {
    results: string;
  };
}

export interface SemSearchToolCall {
  semSearchToolCall: {
    args: SemSearchToolCallArgs;
    result?: SemSearchToolCallSuccessResult;
  };
}

export interface FunctionToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

export type ToolCallPayload =
  | ReadToolCall
  | WriteToolCall
  | EditToolCall
  | DeleteToolCall
  | SemSearchToolCall
  | FunctionToolCall;

export interface JsonSuccessResponse {
  type: "result";
  subtype: "success";
  is_error: false;
  duration_ms: number;
  duration_api_ms: number;
  result: string;
  session_id: string;
  request_id?: string;
}

interface StreamEventBase {
  session_id: string;
}

export interface SystemInitEvent extends StreamEventBase {
  type: "system";
  subtype: "init";
  apiKeySource: "env" | "flag" | "login";
  cwd: string;
  model: string;
  permissionMode: "default" | string;
}

export interface UserMessageEvent extends StreamEventBase {
  type: "user";
  message: Message<"user">;
}

export interface AssistantMessageEvent extends StreamEventBase {
  type: "assistant";
  message: Message<"assistant">;
  timestamp_ms?: number;
}

export interface ToolCallStartedEvent extends StreamEventBase {
  type: "tool_call";
  subtype: "started";
  call_id: string;
  model_call_id?: string;
  tool_call: ToolCallPayload;
  timestamp_ms?: number;
}

export interface ToolCallCompletedEvent extends StreamEventBase {
  type: "tool_call";
  subtype: "completed";
  call_id: string;
  model_call_id?: string;
  tool_call: ToolCallPayload;
  timestamp_ms?: number;
}

export interface ThinkingDeltaEvent extends StreamEventBase {
  type: "thinking";
  subtype: "delta";
  text: string;
  timestamp_ms?: number;
}

export interface ThinkingEvent extends StreamEventBase {
  type: "thinking";
  subtype?: "delta";
  text?: string;
  timestamp_ms?: number;
}

export type ToolCallEvent = ToolCallStartedEvent | ToolCallCompletedEvent;

export type StreamedResultEvent = JsonSuccessResponse;

export type CursorMessage =
  | SystemInitEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | StreamedResultEvent
  | ThinkingEvent
  | ThinkingDeltaEvent;
