import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { chooseNotifyRule, cleanNotifyRuleInput, validateNotifyRule, type NotifyRule, type NotifyRuleInput } from './notifyRules';
import {
  buildNotifyEmail,
  buildRuleTestEmail,
  DEFAULT_NOTIFY_BODY,
  buildPoTableHtml,
  DEFAULT_NOTIFY_SUBJECT,
  fillPlaceholders,
  formatNotifyDate,
  formatNotifyQty,
  isProductionEnvironment,
  JPS_NOTIFY_NON_PRODUCTION_RECIPIENT,
  markAsTestMail,
  resolveNotifyRecipients,
  type NotifyData,
} from './notifyEmail';
import { findIntegration, findSetting, parseEmailList } from '../integrations/registry';

const data: NotifyData = {
  vessel: 'TB. TELUK BAJAU DELTA / BG. SMS 3002',
  commodity: 'CRUDE PALM OIL (CPO)',
  shipper: 'PT. BERAU KARETINDO LESTARI',
  loadingPort: 'LABANAN',
  dischargePort: 'BONTANG',
  masterPort: 'PORT BONTANG',
  qtyKg: 2645542,
  eta: '22 Nov 2026',
  incoterm: 'FOB',
  stoNumber: '1006021140',
  revision: 1,
  rows: [{ shipper: 'PT. BERAU KARETINDO LESTARI', contract: '027/BKL/CPO_EUP/X/2026', po: '1001033468', qtyKg: 2645542 }],
};

describe('Submit to Jetty email: wording', () => {
  it('writes the subject of the hand-written mail when the subject setting is empty', () => {
    const { subject } = buildNotifyEmail(data, {});
    expect(subject).toBe('UPCOMING Vessel EUP BONTANG - TB. TELUK BAJAU DELTA / BG. SMS 3002 - LABANAN to BONTANG');
    expect(DEFAULT_NOTIFY_SUBJECT).toContain('{revision_note}');
  });

  it('marks a resubmission in the subject, and only a resubmission', () => {
    expect(buildNotifyEmail({ ...data, revision: 2 }, {}).subject).toMatch(/ \(Revisi R2\)$/);
    expect(buildNotifyEmail(data, {}).subject).not.toContain('Revisi');
  });

  it('uses the subject and body from the settings, not the built-in ones', () => {
    const { subject, html } = buildNotifyEmail(data, { subject: 'Kapal {vessel} ETA {eta}', body: 'Halo\nSTO {sto_number}\n{po_table}' });
    expect(subject).toBe('Kapal TB. TELUK BAJAU DELTA / BG. SMS 3002 ETA 22 Nov 2026');
    expect(html).toContain('STO 1006021140');
    expect(html).toContain('<table');
    expect(html).not.toContain('Dengan Hormat');
  });

  it('fills every block of the built-in body and keeps the line breaks', () => {
    const { html } = buildNotifyEmail(data, {});
    for (const text of ['Dengan Hormat', 'VESSEL : TB. TELUK BAJAU DELTA / BG. SMS 3002', 'COMMODITY : CRUDE PALM OIL (CPO)', 'LOADING PORT : LABANAN', 'QTY : 2.645.542 Kg', 'ETA BONTANG : 22 Nov 2026', 'TERM : FOB', 'Demikian saya sampaikan']) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('<br>');
  });

  it('leaves a placeholder nobody defined as typed, so a typo in the setting is visible', () => {
    expect(fillPlaceholders('A {vesel} B {vessel}', { vessel: 'X' })).toBe('A {vesel} B X');
  });

  it('escapes what a vessel or shipper name could do to the HTML', () => {
    const { html } = buildNotifyEmail({ ...data, vessel: '<b>X</b> & Y' }, { body: '{vessel}' });
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt; &amp; Y');
    expect(html).not.toContain('<b>X</b>');
  });
});

describe('Submit to Jetty email: PO table and figures', () => {
  it('lists each PO and a TOTAL that adds them', () => {
    const html = buildPoTableHtml([
      { shipper: 'A', contract: 'C1', po: 'P1', qtyKg: 1000 },
      { shipper: 'B', contract: 'C2', po: 'P2', qtyKg: 2500.5 },
    ]);
    expect(html).toContain('>P1<');
    expect(html).toContain('>P2<');
    expect(html).toContain('TOTAL');
    expect(html).toContain('3.500,5');
  });

  it('writes a quantity with dots for thousands and a missing one as a dash', () => {
    expect(formatNotifyQty(2645542)).toBe('2.645.542');
    expect(formatNotifyQty(null)).toBe('-');
  });

  it('writes the ETA date in Jakarta time and a missing one as a dash', () => {
    expect(formatNotifyDate('2026-11-21T20:00:00Z')).toBe('22 Nov 2026');
    expect(formatNotifyDate(null)).toBe('-');
    expect(formatNotifyDate('not a date')).toBe('-');
  });
});

describe('Submit to Jetty email: settings and rules', () => {
  const jps = findIntegration('jps')!;

  it('keeps only the master switch among the integration settings; recipients and wording live in the rules', () => {
    expect(findSetting(jps, 'JPS_NOTIFY_ENABLED')).toBeTruthy();
    for (const key of ['JPS_NOTIFY_TO', 'JPS_NOTIFY_CC', 'JPS_NOTIFY_SUBJECT', 'JPS_NOTIFY_BODY']) {
      expect(findSetting(jps, key), key).toBeUndefined();
    }
  });

  it('splits a recipient list on commas, semicolons and line breaks, and drops a repeat', () => {
    const parsed = parseEmailList('a@x.com, b@x.com;\nA@x.com\r\n c@y.org ');
    expect(parsed.valid).toEqual(['a@x.com', 'b@x.com', 'c@y.org']);
    expect(parsed.invalid).toEqual([]);
  });

  const rule = (over: Partial<NotifyRuleInput> = {}): NotifyRuleInput => ({
    port: 'PORT BONTANG',
    enabled: true,
    emailTo: 'a@x.com',
    emailCc: '',
    subject: 'UPCOMING {vessel}',
    body: 'Dengan Hormat,\n\n{po_table}',
    ...over,
  });

  it('accepts a rule with spaces, line breaks and Indonesian text', () => {
    expect(validateNotifyRule(rule())).toEqual([]);
  });

  it('refuses an address that is not one, naming it, and a rule that is on with nobody to send to', () => {
    expect(validateNotifyRule(rule({ emailTo: 'a@x.com, nope' })).join(' ')).toContain('nope');
    expect(validateNotifyRule(rule({ emailTo: '' })).join(' ')).toContain('at least one address');
    expect(validateNotifyRule(rule({ emailTo: '', enabled: false }))).toEqual([]);
  });

  it('refuses a control character, a two-line subject and a body that is too long', () => {
    expect(validateNotifyRule(rule({ body: 'bad \u0001 text' })).join(' ')).toContain('control character');
    expect(validateNotifyRule(rule({ subject: 'a\nb' })).join(' ')).toContain('one line');
    expect(validateNotifyRule(rule({ body: 'x'.repeat(8001) })).join(' ')).toContain('8000');
  });

  it('cleans what a text box leaves: line breaks settled, ends trimmed, port in upper case, a blank port is the default', () => {
    const cleaned = cleanNotifyRuleInput({ port: ' port  bontang ', enabled: 'true', emailTo: ' a@x.com \r\n', emailCc: '', subject: ' S ', body: 'x\r\ny\n' });
    expect(cleaned).toEqual({ port: 'PORT BONTANG', enabled: true, emailTo: 'a@x.com', emailCc: '', subject: 'S', body: 'x\ny' });
    expect(cleanNotifyRuleInput({ port: '  ' }).port).toBeNull();
  });

  const rules = (ports: Array<[string | null, boolean]>): NotifyRule[] =>
    ports.map(([port, enabled], i) => ({ id: String(i), port, enabled, emailTo: 'a@x.com', emailCc: '', subject: '', body: '', updatedAt: null }));

  it('picks the rule of the shipment\'s own port, else the default, else none', () => {
    const all = rules([[null, true], ['PORT BONTANG', true], ['PORT LUBUK GAUNG', true]]);
    expect(chooseNotifyRule(all, 'PORT BONTANG')?.port).toBe('PORT BONTANG');
    expect(chooseNotifyRule(all, ' port lubuk  gaung ')?.port).toBe('PORT LUBUK GAUNG');
    expect(chooseNotifyRule(all, 'PORT DUMAI')?.port).toBeNull();
    expect(chooseNotifyRule(all, '')?.port).toBeNull();
    expect(chooseNotifyRule(rules([['PORT BONTANG', true]]), 'PORT DUMAI')).toBeNull();
  });

  it('a switched-off rule of a port still wins over the default, so that port sends nothing', () => {
    const all = rules([[null, true], ['PORT BONTANG', false]]);
    const chosen = chooseNotifyRule(all, 'PORT BONTANG');
    expect(chosen?.port).toBe('PORT BONTANG');
    expect(chosen?.enabled).toBe(false);
  });

  it('seeds the default rule with the built-in subject and body (migration 271)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '271_jps_notify_rules.sql'), 'utf8').replace(/\r\n/g, '\n');
    expect(sql).toContain(DEFAULT_NOTIFY_SUBJECT);
    expect(sql).toContain(DEFAULT_NOTIFY_BODY);
  });

  it('builds a test mail from a rule draft with example values, marked as a test', () => {
    const mail = buildRuleTestEmail({ port: 'PORT LUBUK GAUNG', subject: '', body: '' });
    expect(mail.subject.startsWith('[TEST] UPCOMING Vessel EUP LUBUK GAUNG')).toBe(true);
    expect(mail.html).toContain('data contoh');
    expect(mail.html).toContain('<table');
  });
});

describe('Submit to Jetty email: who receives it outside production', () => {
  const to = 'a@x.com, b@x.com';
  const cc = 'c@x.com\nA@x.com';

  it('production uses the configured To and cc, without a repeat across the two', () => {
    const r = resolveNotifyRecipients(to, cc, true);
    expect(r).toMatchObject({ to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'], redirected: false, configuredCount: 3 });
  });

  it('anywhere else only the test address gets it, no cc, whatever is configured', () => {
    const r = resolveNotifyRecipients(to, cc, false);
    expect(r.to).toEqual([JPS_NOTIFY_NON_PRODUCTION_RECIPIENT]);
    expect(r.cc).toEqual([]);
    expect(r.redirected).toBe(true);
    expect(r.configuredCount).toBe(3);
  });

  it('a test host with nothing configured still sends to the test address; production with nothing sends to nobody', () => {
    expect(resolveNotifyRecipients(undefined, undefined, false).to).toEqual([JPS_NOTIFY_NON_PRODUCTION_RECIPIENT]);
    expect(resolveNotifyRecipients(undefined, undefined, true).to).toEqual([]);
  });

  it('counts as production only for KLIP_ENV prod / production; unset or sit fails safe', () => {
    const before = process.env.KLIP_ENV;
    try {
      for (const [value, expected] of [['prod', true], ['production', true], ['PROD', true], ['sit', false], ['', false], [undefined, false]] as const) {
        if (value === undefined) delete process.env.KLIP_ENV;
        else process.env.KLIP_ENV = value;
        expect(isProductionEnvironment(), String(value)).toBe(expected);
      }
    } finally {
      if (before === undefined) delete process.env.KLIP_ENV;
      else process.env.KLIP_ENV = before;
    }
  });

  it('marks a test mail in the subject and the body, and says how many people production would mail', () => {
    const marked = markAsTestMail({ subject: 'UPCOMING Vessel X', html: '<p>isi</p>' }, 61);
    expect(marked.subject).toBe('[TEST] UPCOMING Vessel X');
    expect(marked.html).toContain('61 penerima');
    expect(marked.html).toContain('<p>isi</p>');
  });
});
