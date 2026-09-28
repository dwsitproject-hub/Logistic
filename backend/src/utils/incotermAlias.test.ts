import { describe, expect, it } from 'vitest';
import {
  INCOTERM_ALIASES,
  canonicalIncoterm,
  normalizeIncoterm,
  sqlCanonicalIncotermExpr,
} from './incotermAlias';
import { isShipmentPageSeaIncoterm, normalizeShipmentSeaIncoterm } from './shipmentIncotermScope';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';

describe('CNF is CFR', () => {
  /*
   * Contract 1624000075 - 6,900 MT CPO, SEA, undelivered, past its window - arrived from SAP as CNF
   * and was on Contract Performance and on no execution page. These pin the rule that put it back.
   */
  it('maps both old spellings to CFR', () => {
    expect(INCOTERM_ALIASES).toEqual({ CNF: 'CFR', 'C&F': 'CFR' });
    expect(normalizeIncoterm('CNF')).toBe('CFR');
    expect(normalizeIncoterm(' c&f ')).toBe('CFR');
  });

  it('leaves every other value exactly as given when canonicalising incoming data', () => {
    // Import must change the aliases and nothing else - not case, not whitespace.
    expect(canonicalIncoterm('cnf ')).toBe('CFR');
    expect(canonicalIncoterm('Fob')).toBe('Fob');
    expect(canonicalIncoterm(' FRC')).toBe(' FRC');
    expect(canonicalIncoterm(null)).toBeNull();
    expect(canonicalIncoterm(42)).toBe(42);
  });

  it('puts a CNF contract inside the Shipments / Shipping Performance scope', () => {
    expect(normalizeShipmentSeaIncoterm('CNF')).toBe('CFR');
    expect(isShipmentPageSeaIncoterm('CNF')).toBe(true);
    expect(isShipmentPageSeaIncoterm('FRC')).toBe(false);
  });

  it('reads its SQL input once, so a correlated subquery is not evaluated twice', () => {
    const sql = sqlCanonicalIncotermExpr('X');
    expect(sql).toBe(`regexp_replace(X, '^(CNF|C&F)$', 'CFR')`);
    expect(sql.match(/X/g)).toHaveLength(1);
  });

  it('canonicalises the effective incoterm every page scopes by', () => {
    const sql = contractEffectiveIncotermExpr('c');
    expect(sql.startsWith('regexp_replace(UPPER(TRIM(COALESCE(')).toBe(true);
    // The correlated SAP fallback must appear once, not once per CASE branch.
    expect(sql.match(/FROM sap_processed_data/g)).toHaveLength(1);
  });
});
