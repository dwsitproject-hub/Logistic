-- Email sent after Submit to Jetty (JPS): one RULE per discharge port, edited in Integrations > JPS > Email notifications.
--
-- A rule says who receives the mail and what it says for ONE Master Port (port = the Master Port name in upper case, e.g. 'PORT BONTANG'), because the
-- people to inform and the wording differ per port. A rule with port NULL is the DEFAULT: it applies to every port that has no rule of its own. A port rule
-- always wins over the default, including a port rule that is switched off (that port then sends nothing).
--
-- Nothing is sent from here by itself: the master switch JPS_NOTIFY_ENABLED (Integrations > JPS) must be on, and outside production every mail goes only to
-- the test address whatever a rule says (backend/src/jps/notifyEmail.ts).
--
-- The default rule is seeded with the format of the hand-written "UPCOMING Vessel" mail the shipping team sends today (subject and body). It is seeded
-- WITHOUT recipients on purpose: the addresses are entered in the modal, never in a migration, and a rule without a recipient sends nothing in production.
-- The seed text is the same as DEFAULT_NOTIFY_SUBJECT / DEFAULT_NOTIFY_BODY in notifyEmail.ts (a test compares them).

CREATE TABLE IF NOT EXISTS jps_notify_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  port        VARCHAR(255),
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  email_to    TEXT        NOT NULL DEFAULT '',
  email_cc    TEXT        NOT NULL DEFAULT '',
  subject     TEXT        NOT NULL DEFAULT '',
  body        TEXT        NOT NULL DEFAULT '',
  updated_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One rule per port, and one default (NULL port).
CREATE UNIQUE INDEX IF NOT EXISTS ux_jps_notify_rules_port ON jps_notify_rules ((COALESCE(port, '')));

INSERT INTO jps_notify_rules (port, enabled, email_to, email_cc, subject, body)
SELECT NULL, TRUE, '', '',
       'UPCOMING Vessel EUP {discharge_port} - {vessel} - {loading_port} to {discharge_port}{revision_note}',
       $body$Dengan Hormat,

Berikut saya informasikan detail pengapalan {discharge_port}, dengan detail sebagai berikut :

VESSEL : {vessel}
COMMODITY : {commodity}
SHIPPER : {shipper}
LOADING PORT : {loading_port}
QTY : {qty_kg} Kg
ETA {discharge_port} : {eta}
TERM : {incoterm}

{po_table}

Demikian saya sampaikan, terima kasih.$body$
WHERE NOT EXISTS (SELECT 1 FROM jps_notify_rules WHERE port IS NULL);
