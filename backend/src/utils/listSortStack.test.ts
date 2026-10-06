import { describe, expect, it } from 'vitest';
import { listSortThenByKey, parseListSortStack, resolveListSortRequest } from './listSortStack';

const allowed = (key: string) => ['supplier', 'product', 'incoterm', 'created_at'].includes(key);

describe('parseListSortStack', () => {
  it('reads keys and directions in order', () => {
    expect(parseListSortStack('incoterm:asc,product:asc,supplier:desc', allowed)).toEqual([
      { key: 'incoterm', dir: 'ASC' },
      { key: 'product', dir: 'ASC' },
      { key: 'supplier', dir: 'DESC' },
    ]);
  });

  it('drops unknown, duplicate and malformed keys instead of rejecting the request', () => {
    expect(parseListSortStack('supplier:asc,supplier:desc,drop table:asc,product:sideways,,incoterm', allowed)).toEqual([
      { key: 'supplier', dir: 'ASC' },
      { key: 'incoterm', dir: 'ASC' },
    ]);
  });

  it('keeps at most three keys', () => {
    expect(parseListSortStack('supplier,product,incoterm,created_at', allowed).map((e) => e.key)).toEqual([
      'supplier',
      'product',
      'incoterm',
    ]);
  });

  it('is empty for nothing usable', () => {
    expect(parseListSortStack(undefined, allowed)).toEqual([]);
    expect(parseListSortStack('', allowed)).toEqual([]);
    expect(parseListSortStack(42, allowed)).toEqual([]);
    expect(parseListSortStack('nope:asc', allowed)).toEqual([]);
  });

  it('takes the first value when the parameter is repeated', () => {
    expect(parseListSortStack(['supplier:desc', 'product:asc'], allowed)).toEqual([{ key: 'supplier', dir: 'DESC' }]);
  });
});

describe('resolveListSortRequest', () => {
  const options = { isAllowedKey: allowed, defaultKey: 'created_at', defaultDirRaw: 'asc' };

  it('without `sort` it is the legacy pair, with an empty thenBy', () => {
    expect(resolveListSortRequest({ sortKey: 'supplier', sortDir: 'desc' }, options)).toEqual({
      sortKey: 'supplier',
      sortDir: 'DESC',
      sortDirRaw: 'desc',
      thenBy: [],
    });
    expect(resolveListSortRequest({}, options)).toEqual({
      sortKey: 'created_at',
      sortDir: 'ASC',
      sortDirRaw: 'asc',
      thenBy: [],
    });
  });

  it('keeps a legacy sortKey the stack whitelist does not know - existing single sorts must not change', () => {
    expect(resolveListSortRequest({ sortKey: 'something_else', sortDir: 'asc' }, options).sortKey).toBe('something_else');
  });

  it('with `sort` the first entry is primary and the rest are thenBy', () => {
    expect(
      resolveListSortRequest(
        { sort: 'incoterm:asc,product:desc,supplier:asc', sortKey: 'supplier', sortDir: 'asc' },
        options,
      ),
    ).toEqual({
      sortKey: 'incoterm',
      sortDir: 'ASC',
      sortDirRaw: 'asc',
      thenBy: [
        { key: 'product', dir: 'DESC' },
        { key: 'supplier', dir: 'ASC' },
      ],
    });
  });

  it('falls back to the legacy pair when `sort` holds nothing usable', () => {
    expect(resolveListSortRequest({ sort: 'nope:asc', sortKey: 'product', sortDir: 'desc' }, options)).toMatchObject({
      sortKey: 'product',
      sortDir: 'DESC',
      thenBy: [],
    });
  });
});

describe('listSortThenByKey', () => {
  it('is empty for a single sort, so existing cache keys do not change', () => {
    expect(listSortThenByKey([])).toBe('');
    expect(listSortThenByKey(undefined)).toBe('');
  });

  it('spells the extra keys otherwise', () => {
    expect(
      listSortThenByKey([
        { key: 'product', dir: 'ASC' },
        { key: 'supplier', dir: 'DESC' },
      ]),
    ).toBe(':then=product:ASC,supplier:DESC');
  });
});
