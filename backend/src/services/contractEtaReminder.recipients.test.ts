import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./email.service', () => ({ sendEmail: vi.fn() }));
vi.mock('./sessionAuth.service', () => ({ frontendUrl: () => 'https://klip.example' }));

import { findEtaReminderRecipients, isEtaReminderRecipient } from './contractEtaReminder.service';

describe('isEtaReminderRecipient: Admin, and the Section Heads / Dept Heads of Logistics', () => {
  it('Section Head and Dept Head count only under LOGISTICS', () => {
    expect(isEtaReminderRecipient({ role: 'LOGISTICS', level: 'Section Head' })).toBe(true);
    expect(isEtaReminderRecipient({ role: 'LOGISTICS', level: 'Dept Head' })).toBe(true);
    expect(isEtaReminderRecipient({ role: ' logistics ', level: ' section head ' })).toBe(true);
    for (const role of ['COMMERCIAL', 'FINANCE', 'Commercial Documents', 'TRADING', null]) {
      expect(isEtaReminderRecipient({ role, level: 'Section Head' })).toBe(false);
      expect(isEtaReminderRecipient({ role, level: 'Dept Head' })).toBe(false);
    }
  });

  it('Admin counts whatever the department: level Admin, or role ADMIN', () => {
    expect(isEtaReminderRecipient({ role: 'LOGISTICS', level: 'Admin' })).toBe(true);
    expect(isEtaReminderRecipient({ role: 'COMMERCIAL', level: 'Admin' })).toBe(true);
    expect(isEtaReminderRecipient({ role: 'ADMIN', level: null })).toBe(true);
    expect(isEtaReminderRecipient({ role: 'admin', level: 'Staff' })).toBe(true);
  });

  it('Staff, and a user with no level, never do (a Logistics user with no level is left out too)', () => {
    expect(isEtaReminderRecipient({ role: 'LOGISTICS', level: 'Staff' })).toBe(false);
    expect(isEtaReminderRecipient({ role: 'LOGISTICS', level: null })).toBe(false);
    expect(isEtaReminderRecipient({ role: 'LOGISTICS', level: '' })).toBe(false);
    expect(isEtaReminderRecipient({ role: null, level: null })).toBe(false);
  });
});

describe('findEtaReminderRecipients', () => {
  beforeEach(() => queryMock.mockReset());

  it('reads the active users with an email and keeps the ones the rule picks, with trimmed addresses', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { email: 'head@kpn.com ', full_name: 'Head', role: 'LOGISTICS', level: 'Dept Head' },
        { email: 'section@kpn.com', full_name: 'Section', role: 'LOGISTICS', level: 'Section Head' },
        { email: 'staff@kpn.com', full_name: 'Staff', role: 'LOGISTICS', level: 'Staff' },
        { email: 'commercial-head@kpn.com', full_name: 'Commercial', role: 'COMMERCIAL', level: 'Dept Head' },
        { email: 'admin@kpn.com', full_name: 'Admin', role: 'ADMIN', level: null },
      ],
    });
    const recipients = await findEtaReminderRecipients();
    expect(recipients.map((r) => r.email)).toEqual(['head@kpn.com', 'section@kpn.com', 'admin@kpn.com']);
    expect(String(queryMock.mock.calls[0][0])).toMatch(/is_active = true/);
  });
});
