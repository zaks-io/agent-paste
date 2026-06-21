import type { TokenUsage } from "../types";

export type HarnessRunOutput = {
  finalAnswer: string;
  transcript: string;
  tokenUsage?: TokenUsage;
  costUsd?: number;
  turnCount?: number;
  eventsPath: string;
  transcriptPath: string;
};

export class HarnessRunError extends Error {
  constructor(
    message: string,
    readonly output: HarnessRunOutput,
  ) {
    super(message);
    this.name = "HarnessRunError";
  }
}
