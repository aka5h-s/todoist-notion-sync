import { setTimeout as sleep } from "node:timers/promises";
import { APIResponseError } from "@notionhq/client";
import axios from "axios";
import { logger } from "./logger.js";

interface RetryOptions {
  operation: string;
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

const retryableStatusCodes = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export async function withRetry<T>(
  fn: () => Promise<T>,
  { operation, attempts = 5, minDelayMs = 500, maxDelayMs = 30_000 }: RetryOptions
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryAfterMs = getRetryAfterMs(error);
      const status = getStatusCode(error);
      const retryable = status === undefined || retryableStatusCodes.has(status);

      if (!retryable || attempt === attempts) {
        throw error;
      }

      const exponentialDelay = Math.min(maxDelayMs, minDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 250);
      const delayMs = retryAfterMs ?? exponentialDelay + jitter;

      logger.warn({ operation, attempt, status, delayMs }, "retrying failed operation");
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function getStatusCode(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }

  if (error instanceof APIResponseError) {
    return error.status;
  }

  return undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  const header = axios.isAxiosError(error)
    ? error.response?.headers["retry-after"]
    : error instanceof APIResponseError
      ? error.headers?.["retry-after"]
      : undefined;

  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
