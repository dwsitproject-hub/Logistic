import { afterEach, describe, expect, it } from 'vitest';
import { isAttentionInsightsEnabled } from './attentionInsightsConfig';

describe('attentionInsightsConfig', () => {
  afterEach(() => {
    delete process.env.ATTENTION_INSIGHTS_ENABLED;
  });

  it('is disabled by default', () => {
    expect(isAttentionInsightsEnabled()).toBe(false);
  });

  it('is enabled when ATTENTION_INSIGHTS_ENABLED=true', () => {
    process.env.ATTENTION_INSIGHTS_ENABLED = 'true';
    expect(isAttentionInsightsEnabled()).toBe(true);
  });
});
