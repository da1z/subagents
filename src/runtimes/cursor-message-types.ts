// Base types for message content and structure
export interface TextContent {
  type: 'text';
  text: string;
}

export interface Message<Role extends 'user' | 'assistant'> {
  role: Role;
  content: TextContent[];
}

// --- Tool Call Types ---

// Read File Tool
export interface ReadToolCallArgs {
  path: string;
}

export interface ReadToolCallSuccessResult {
  success: {
    content: string;
    isEmpty: boolean;
    exceededLimit: boolean;
    totalLines: number;
    totalChars: number;
  };
}

export interface ReadToolCall {
  readToolCall: {
    args: ReadToolCallArgs;
    result?: ReadToolCallSuccessResult;
  };
}

// Write File Tool
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

// Generic Function Tool
export interface FunctionToolCall {
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// Union for all possible tool call structures
export type ToolCallPayload = ReadToolCall | WriteToolCall | FunctionToolCall;

// --- JSON Output Format Types ---

export interface JsonSuccessResponse {
  type: 'result';
  subtype: 'success';
  is_error: false;
  duration_ms: number;
  duration_api_ms: number;
  result: string;
  session_id: string;
  request_id?: string;
}

// --- Stream JSON (NDJSON) Event Types ---

interface StreamEventBase {
  session_id: string;
}

export interface SystemInitEvent extends StreamEventBase {
  type: 'system';
  subtype: 'init';
  apiKeySource: 'env' | 'flag' | 'login';
  cwd: string;
  model: string;
  permissionMode: 'default'; // Assuming 'default' is one of possible values
}

export interface UserMessageEvent extends StreamEventBase {
  type: 'user';
  message: Message<'user'>;
}

export interface AssistantMessageEvent extends StreamEventBase {
  type: 'assistant';
  message: Message<'assistant'>;
}

export interface ToolCallStartedEvent extends StreamEventBase {
  type: 'tool_call';
  subtype: 'started';
  call_id: string;
  tool_call: ToolCallPayload;
}

export interface ToolCallCompletedEvent extends StreamEventBase {
  type: 'tool_call';
  subtype: 'completed';
  call_id: string;
  tool_call: Required<ToolCallPayload>; // Result is required on completion
}

export type ToolCallEvent = ToolCallStartedEvent | ToolCallCompletedEvent;

// The final event in a stream is the same as the single JSON output
export type StreamedResultEvent = JsonSuccessResponse;

// A discriminated union of all possible events in an NDJSON stream
export type CursorMessage =
  | SystemInitEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | StreamedResultEvent;
