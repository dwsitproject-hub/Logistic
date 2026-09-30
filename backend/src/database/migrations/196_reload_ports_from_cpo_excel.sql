-- Replace Master Port with the Port sheet from
-- docs/Master Data - CPO 28 Sep 2026.xlsx. Existing master rows are removed first.

DELETE FROM master_loading_ports;

SELECT setval('master_port_klip_code_seq', 1, false);

INSERT INTO master_loading_ports (port) VALUES
('PORT BATAM'),
('PORT BONTANG'),
('PORT DUMAI'),
('PORT LOKTUAN'),
('PORT MARUNDA CENTRAL (MCT)'),
('PORT PELINDO KIJING'),
('PORT SEBULU'),
('PORT TANJUNG PRIOK');
