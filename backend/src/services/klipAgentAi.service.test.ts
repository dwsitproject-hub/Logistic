import { afterEach, describe, expect, it } from 'vitest';
import {
  isAnthropicConfigured,
  isSupportedAgentImageMediaType,
  KLIP_AGENT_PERSONA,
  KLIP_AGENT_SYSTEM_PROMPT,
  MAX_IMAGE_BYTES,
  resolveAgentEffort,
} from './klipAgentAi.service';
import { resolveAnthropicAgentModel, resolveAnthropicApiKeyName } from '../constants/aiKlipAgent';

/**
 * The persona is a business-owner requirement quoted verbatim. This literal is the
 * contract: if someone paraphrases or "tidies" the prompt, this test fails.
 */
const REQUESTED_PERSONA =
  'Act as you are Logistic and Commercial Principle Senior, that has experience more than 15 years ' +
  'in manufacture downstream palm oil industry, and has expertise in SAP as well. you need to answer ' +
  'step by step really clear and give interactive flow. also always criticize and double check your ' +
  'answer, and what can goes wrong';

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AGENT_MODEL', 'ANTHROPIC_AGENT_EFFORT', 'ANTHROPIC_MODEL'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key] as string;
  }
});

describe('klipAgentAi persona', () => {
  it('keeps the requested persona instruction verbatim', () => {
    expect(KLIP_AGENT_PERSONA).toBe(REQUESTED_PERSONA);
  });

  it('leads the system prompt with the persona', () => {
    expect(KLIP_AGENT_SYSTEM_PROMPT.startsWith(REQUESTED_PERSONA)).toBe(true);
  });

  it('still demands the strict JSON envelope the frontend parses', () => {
    for (const field of ['"answer"', '"report"', '"insights"', '"comparison"']) {
      expect(KLIP_AGENT_SYSTEM_PROMPT).toContain(field);
    }
    expect(KLIP_AGENT_SYSTEM_PROMPT).toContain('strict, raw JSON object');
  });

  it('keeps the accuracy rule that outranks the persona', () => {
    expect(KLIP_AGENT_SYSTEM_PROMPT).toContain('Never invent an exact value');
    expect(KLIP_AGENT_SYSTEM_PROMPT).toContain('direct_fact');
  });
});

describe('klipAgentAi model + effort resolution', () => {
  it('defaults the chat agent to Claude Sonnet 5', () => {
    delete process.env.ANTHROPIC_AGENT_MODEL;
    expect(resolveAnthropicAgentModel()).toBe('claude-sonnet-5');
  });

  it('honours an explicit chat-agent model override', () => {
    process.env.ANTHROPIC_AGENT_MODEL = 'claude-opus-5';
    expect(resolveAnthropicAgentModel()).toBe('claude-opus-5');
  });

  it('does not let the chat model leak into the Shipment Planner', () => {
    process.env.ANTHROPIC_AGENT_MODEL = 'claude-opus-5';
    delete process.env.ANTHROPIC_MODEL;
    expect(resolveAnthropicApiKeyName()).toBe('Anthropic (claude-sonnet-4-6)');
  });

  it('defaults effort to medium and rejects unknown values', () => {
    delete process.env.ANTHROPIC_AGENT_EFFORT;
    expect(resolveAgentEffort()).toBe('medium');
    process.env.ANTHROPIC_AGENT_EFFORT = 'nonsense';
    expect(resolveAgentEffort()).toBe('medium');
    process.env.ANTHROPIC_AGENT_EFFORT = 'HIGH';
    expect(resolveAgentEffort()).toBe('high');
  });

  it('reports whether the API key is configured', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAnthropicConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = '   ';
    expect(isAnthropicConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(isAnthropicConfigured()).toBe(true);
  });
});

describe('klipAgentAi image guards', () => {
  it('accepts only the media types the Messages API supports', () => {
    for (const ok of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'IMAGE/PNG']) {
      expect(isSupportedAgentImageMediaType(ok)).toBe(true);
    }
    for (const bad of ['image/bmp', 'image/tiff', 'image/svg+xml', 'application/pdf', '']) {
      expect(isSupportedAgentImageMediaType(bad)).toBe(false);
    }
  });

  it('caps a single image below the request limit', () => {
    expect(MAX_IMAGE_BYTES).toBeLessThan(32 * 1024 * 1024);
  });
});
