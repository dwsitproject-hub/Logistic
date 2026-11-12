/**
 * The error a push records when the call to DHM itself threw (the network, the token, a timeout) or KLIP failed to store what DHM answered. It used to be the bare words "DHM unavailable"
 * for all of them, so 47 vessels could sit at "DHM unavailable" after 11 attempts with nothing to say which of those it was. The first words stay (the Integrations page and the
 * retry rules know them); the reason follows, short and without line breaks.
 */
export function dhmUnavailableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const reason = raw.replace(/\s+/g, ' ').trim().slice(0, 160);
  return reason ? `DHM unavailable: ${reason}` : 'DHM unavailable';
}
