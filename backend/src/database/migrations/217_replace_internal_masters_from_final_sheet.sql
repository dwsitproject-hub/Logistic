-- Replace Master Company (Internal), Master Site and Master Plant with the sheet "Internal Company (Final)" of
-- docs/Master Data - CPO 28 Sep 2026.xlsx: 11 companies, 23 Sites, 148 plants, every plant with a Site.
--
-- The sheet is the only source. Whatever the three tables held before and the sheet does not name is removed;
-- what it names is kept, so nothing a row learned from DHM is thrown away:
--   * a company is matched by code (CD, EO ...), else by name with dots and case ignored (EU is EUP on SIT);
--     it keeps its id, its KLIP code and every dhm_* column and is only renamed to the sheet's spelling;
--   * a Site is matched by name; a plant by plant code;
--   * links between companies and Sites are rebuilt from the plants (a company is on every Site where it has a plant).
-- Rows only in KLIP are deleted: on SIT 12 companies (AS, BM, BN, CS, MG, ND, PE, SB, SD, SS, UI and the duplicate
-- EOP), their Sites (PROBOLINGGO, BAYAH, SALO PALAI, SINTETE, TRADING TRANSIT HO and DHM's two terminals) and the
-- plants outside the sheet. Ports and discharge_port_aliases that pointed at a deleted Site only lose that link.
--
-- DHM still holds the deleted organisations and sites. Until they are deleted THERE the DHM sync brings them back
-- as new local rows, so delete them in DHM too (the list is in README). master_sites.company_name is left alone: it
-- is the preference companyDhmCodeForSite uses to pick one company for a Site that has several.
--
-- Deletes data: the deploy script asks for a backup of master_companies, master_company_sites, master_sites and
-- master_plants first. Idempotent: a second run changes nothing.

CREATE TEMP TABLE final_companies (company_code text PRIMARY KEY, company_name text NOT NULL) ON COMMIT DROP;
INSERT INTO final_companies VALUES
  ('CD', 'PT. CISADANE RAYA CHEMICALS'),
  ('EO', 'PT. ENERGI OLEO PERSADA'),
  ('EU', 'PT ENERGI UNGGUL PERSADA'),
  ('GM', 'Gulf Lubes Malaysia Sdn Bhd'),
  ('JP', 'PT. JATI PERKASA NUSANTARA'),
  ('PM', 'PT Prima Makmur Cakrawala'),
  ('PS', 'PT Priscolin'),
  ('RB', 'PT RIAU SEMESTA BIOMASSA'),
  ('RI', 'PT Royal Foods Indonesia'),
  ('SC', 'PT Sumber Pangan Cemerlang'),
  ('TP', 'TPG Oil & Gas Sdn Bhd');

CREATE TEMP TABLE final_sites (site_name text PRIMARY KEY, city text, postal_code text) ON COMMIT DROP;
INSERT INTO final_sites VALUES
  ('BAGENDANG', 'BAGENDANG', '74361'),
  ('BATAM', 'BATAM', '29444'),
  ('BEKASI', 'BEKASI', '17131'),
  ('BONTANG', 'BONTANG', '75325'),
  ('BOVENDIGUL', 'PAPUA', NULL),
  ('GRESIK', 'GRESIK', '61119'),
  ('JAKARTA', 'JAKARTA', '12980'),
  ('JAMBI', 'JAMBI', '75325'),
  ('KARAWANG', 'KARAWANG', '41361'),
  ('KUMAI', 'KUMAI', '74181'),
  ('LUBUK GAUNG', 'DUMAI', '28826'),
  ('MERAUKE', 'MERAUKE', '99613'),
  ('PALEMBANG', 'PALEMBANG', '30961'),
  ('PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700'),
  ('PAYA PASIR', 'PAYA PASIR', '20255'),
  ('RIAU', 'DKI JAKARTA', '10350'),
  ('SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920'),
  ('SIDOARJO', 'SIDOARJO', NULL),
  ('SINTANG', 'SINTANG', '78613'),
  ('TANGERANG', 'TANGERANG', '15115'),
  ('TANJUNG BUTON', 'PEKAN BARU', '28662'),
  ('TANJUNG MORAWA', 'TANJUNG MORAWA', '20362'),
  ('TANJUNG PURA', 'TANJUNG PURA', '78371');

CREATE TEMP TABLE final_company_sites (company_code text, site_name text, PRIMARY KEY (company_code, site_name)) ON COMMIT DROP;
INSERT INTO final_company_sites VALUES
  ('CD', 'JAKARTA'),
  ('CD', 'TANGERANG'),
  ('EO', 'BONTANG'),
  ('EO', 'JAKARTA'),
  ('EO', 'TANJUNG MORAWA'),
  ('EU', 'BAGENDANG'),
  ('EU', 'BATAM'),
  ('EU', 'BEKASI'),
  ('EU', 'BONTANG'),
  ('EU', 'BOVENDIGUL'),
  ('EU', 'JAKARTA'),
  ('EU', 'JAMBI'),
  ('EU', 'KARAWANG'),
  ('EU', 'KUMAI'),
  ('EU', 'LUBUK GAUNG'),
  ('EU', 'MERAUKE'),
  ('EU', 'PALEMBANG'),
  ('EU', 'PAYA PASIR'),
  ('EU', 'SINTANG'),
  ('EU', 'TANJUNG PURA'),
  ('GM', 'SELANGOR'),
  ('JP', 'BEKASI'),
  ('JP', 'GRESIK'),
  ('JP', 'JAKARTA'),
  ('JP', 'LUBUK GAUNG'),
  ('JP', 'SIDOARJO'),
  ('JP', 'TANGERANG'),
  ('PM', 'JAKARTA'),
  ('PM', 'LUBUK GAUNG'),
  ('PS', 'BEKASI'),
  ('PS', 'JAKARTA'),
  ('PS', 'KARAWANG'),
  ('RB', 'JAKARTA'),
  ('RB', 'RIAU'),
  ('RB', 'TANJUNG BUTON'),
  ('RI', 'BEKASI'),
  ('RI', 'JAKARTA'),
  ('SC', 'BATAM'),
  ('SC', 'JAKARTA'),
  ('SC', 'LUBUK GAUNG'),
  ('TP', 'PASIR GUDANG');

CREATE TEMP TABLE final_plants (
  company_code text, company_name text, plant_code text PRIMARY KEY, plant_name text, plant_type text,
  site_name text, city text, postal_code text, found_in text
) ON COMMIT DROP;
INSERT INTO final_plants VALUES
  ('CD', 'PT. CISADANE RAYA CHEMICALS', 'CD00', 'CRC GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'DKI JAKARTA', '12940', 'DWS ONLY'),
  ('CD', 'PT. CISADANE RAYA CHEMICALS', 'CD10', 'CRC TRADING PLANT', 'HO TRADING', 'JAKARTA', 'DKI JAKARTA', '12940', 'DWS ONLY'),
  ('CD', 'PT. CISADANE RAYA CHEMICALS', 'CD21', 'CRC OLEO CHEMICAL TANGERANG', 'MILL PROCESS', 'TANGERANG', 'TANGERANG', '15115', 'SAP & DWS'),
  ('CD', 'PT. CISADANE RAYA CHEMICALS', 'CD22', 'CRC OLEO CHEMICAL TANGERANG 2', 'MILL PROCESS', 'TANGERANG', 'TANGERANG', '15115', 'DWS ONLY'),
  ('CD', 'PT. CISADANE RAYA CHEMICALS', 'CD2A', 'CRC REFINERY TANGERANG', 'MILL PROCESS', 'TANGERANG', 'BOJONG JAYA KARAWACI, BANTEN', '15115', 'SAP & DWS'),
  ('CD', 'PT. CISADANE RAYA CHEMICALS', 'CD90', 'CRC PROJ HO JAKARTA', 'HO PROJECT', 'JAKARTA', 'DKI JAKARTA', '12940', 'DWS ONLY'),
  ('CD', 'PT. CISADANE RAYA CHEMICALS', 'CD91', 'CRC PROJ TANGERANG', 'MILL PROJECT', 'TANGERANG', 'BOJONG JAYA KARAWACI, BANTEN', '15115', 'DWS ONLY'),
  ('CD', 'PT. CISADANE RAYA CHEMICALS', 'CD9A', 'CRC PROJ REFINERY TANGERANG', 'MILL PROJECT', 'TANGERANG', 'BOJONG JAYA KARAWACI, BANTEN', '15115', 'DWS ONLY'),
  ('EO', 'PT. ENERGI OLEO PERSADA', 'EO00', 'EOP GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'DKI JAKARTA', '12940', 'DWS ONLY'),
  ('EO', 'PT. ENERGI OLEO PERSADA', 'EO10', 'EOP TRADING PLANT', 'HO TRADING', 'BONTANG', 'DKI JAKARTA', '12940', 'SAP & DWS'),
  ('EO', 'PT. ENERGI OLEO PERSADA', 'EO21', 'EOP GENERAL TJ. MORAWA', 'MILL PROCESS', 'TANJUNG MORAWA', 'TANJUNG MORAWA', '20362', 'SAP & DWS'),
  ('EO', 'PT. ENERGI OLEO PERSADA', 'EO22', 'EOP GENERAL BELAWAN', 'MILL PROCESS', 'TANJUNG MORAWA', 'TANJUNG MORAWA', '20411', 'SAP & DWS'),
  ('EO', 'PT. ENERGI OLEO PERSADA', 'EO2A', 'EOP REFINERY TJ.MORAWA', 'MILL PROCESS', 'TANJUNG MORAWA', 'TJ. MORAWA', '20362', 'SAP & DWS'),
  ('EO', 'PT. ENERGI OLEO PERSADA', 'EO90', 'EOP PROJ HO JAKARTA', 'HO PROJECT', 'JAKARTA', 'DKI JAKARTA', '12940', 'DWS ONLY'),
  ('EO', 'PT. ENERGI OLEO PERSADA', 'EO91', 'EOP PROJ TJ. MORAWA', 'MILL PROJECT', 'TANJUNG MORAWA', 'TJ. MORAWA', '20362', 'DWS ONLY'),
  ('EO', 'PT. ENERGI OLEO PERSADA', 'EO92', 'EOP-PROJECT BELAWAN', 'MILL PROCESS', 'TANJUNG MORAWA', 'BELAWAN', '20411', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU00', 'EUP GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU10', 'EUP TRADING PLANT', 'HO TRADING', 'KARAWANG', 'DKI JAKARTA', '12980', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU21', 'EUP EDIBLE OIL LUBUK GAUNG', 'MILL PROCESS', 'LUBUK GAUNG', 'DUMAI', '28826', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU22', 'EUP EDIBLE OIL BONTANG', 'MILL PROCESS', 'BONTANG', 'BONTANG', '75325', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU23', 'EUP EDIBLE OIL TJ.PURA', 'MILL PROCESS', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU24', 'EUP EDIBLE OIL KUMAI', 'MILL PROCESS', 'KUMAI', 'KUMAI', '74181', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU25', 'EUP EDIBLE OIL PALEMBANG', 'MILL PROCESS', 'PALEMBANG', 'PALEMBANG', '30961', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU26', 'EUP EDIBLE OIL BATAM', 'MILL PROCESS', 'BATAM', 'BATAM', '29444', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU27', 'EUP EDIBLE OIL SINTANG', 'MILL PROCESS', 'SINTANG', 'SINTANG', '78613', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU28', 'EUP EDIBLE OIL MERAUKE', 'MILL PROCESS', 'MERAUKE', 'MERAUKE', '99613', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU29', 'EUP EDIBLE OIL BAGENDANG', 'MILL PROCESS', 'BAGENDANG', 'KALIMANTAN TENGAH', NULL, 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU2B', 'EUP BIODIESEL BONTANG (OLD)', 'MILL PROCESS', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU2C', 'EUP BIODIESEL TJ.PURA OLD', 'MILL PROCESS', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU2D', 'EUP OLEO CHEMICAL BONTANG', 'MILL PROCESS', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU2E', 'EUP OLEO CHEMICAL TJ.PURA', 'MILL PROCESS', 'TANJUNG PURA', 'TANJUNG PURA', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU2Y', 'EUP EDIBLE OIL PAYA PASIR', 'MILL PROCESS', 'PAYA PASIR', 'PAYA PASIR', '20255', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU2Z', 'EUP EDIBLE OIL BEKASI', 'MILL PROCESS', 'BEKASI', 'BEKASI', '17131', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU31', 'EUP EDIBLE OIL BOVENDIGUL', 'MILL PROCESS', 'BOVENDIGUL', 'MERAUKE', NULL, 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU3A', 'EUP BIODIESEL BOVENDIGUL', 'MILL PROCESS', 'BOVENDIGUL', 'MERAUKE', NULL, 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU4B', 'EUP BIODIESEL BONTANG', 'MILL PROCESS', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU4C', 'EUP BIODIESEL TJ.PURA', 'MILL PROCESS', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU4D', 'EUP OLEO CHEMICAL BONTANG', 'MILL PROCESS', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU4E', 'EUP OLEO CHEMICAL TJ. PURA', 'MILL PROCESS', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU51', 'EUP BIOMASS LUBUK GAUNG', 'SPECIAL MILL PROCESS', 'LUBUK GAUNG', 'DUMAI', '28826', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU52', 'EUP BIOMASS BONTANG', 'SPECIAL MILL PROCESS', 'BONTANG', 'BONTANG', '75325', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU53', 'EUP BIOMASS TJ.PURA', 'SPECIAL MILL PROCESS', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU54', 'EUP BIOMASS KUMAI', 'SPECIAL MILL PROCESS', 'KUMAI', 'KUMAI', '74181', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU55', 'EUP BIOMASS PALEMBANG', 'SPECIAL MILL PROCESS', 'PALEMBANG', 'PALEMBANG', '30961', 'SAP & DWS'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU62', 'EUP BATCHING PLANT BONTANG', 'MILL PROCESS', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU71', 'EUP GENERAL LUBUK GAUNG', 'MILL GENERAL', 'LUBUK GAUNG', 'DUMAI', '28826', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU72', 'EUP GENERAL BONTANG', 'MILL GENERAL', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU73', 'EUP GENERAL TJ.PURA', 'MILL GENERAL', 'TANJUNG PURA', 'TJ.PURA', '78371', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU74', 'EUP GENERAL KUMAI', 'MILL GENERAL', 'KUMAI', 'KUMAI', '74181', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU75', 'EUP GENERAL PALEMBANG', 'MILL GENERAL', 'PALEMBANG', 'PALEMBANG', '30961', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU76', 'EUP GENERAL BATAM', 'MILL GENERAL', 'BATAM', 'BATAM', '29444', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU77', 'EUP GENERAL SINTANG', 'MILL GENERAL', 'SINTANG', 'SINTANG', '78613', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU78', 'EUP GENERAL MERAUKE', 'MILL GENERAL', 'MERAUKE', 'MERAUKE', '99613', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU7A', 'EUP-GENERAL BOVENDIDUL', 'MILL GENERAL', 'BOVENDIGUL', 'PAPUA', NULL, 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU7Y', 'EUP GENERALPAYA PASIR', 'MILL PROCESS', 'PAYA PASIR', 'PAYA PASIR', '20255', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU8B', 'EUP PROJ BIODESEL BONTANG', 'MILL PROJECT', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU8C', 'EUP PROJ BIODIESEL TJ.PURA', 'MILL PROJECT', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU8E', 'EUP PROJ OLEO CHEMICAL TJ.PURA', 'MILL PROJECT', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU8F', 'EUP-PROJ BOVENDIGUL BIODIESEL', 'MILL PROJECT', 'BOVENDIGUL', 'PAPUA', NULL, 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU8W', 'EUP PROJ BATCHING PLANT BONTAN', 'MILL PROJECT', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU90', 'EUP-PROJ HO JAKARTA', 'HO PROJECT', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU91', 'EUP PROJ LUBUK GAUNG', 'MILL PROJECT', 'LUBUK GAUNG', 'DUMAI', '28826', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU92', 'EUP PROJ BONTANG OLD', 'MILL PROJECT', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU93', 'EUP PROJ TJ.PURA OLD', 'MILL PROJECT', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU94', 'EUP PROJ KUMAI', 'MILL PROJECT', 'KUMAI', 'KUMAI', '74181', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU95', 'EUP PROJ PALEMBANG', 'MILL PROJECT', 'PALEMBANG', 'PALEMBANG', '30961', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU96', 'EUP PROJ BATAM', 'MILL PROJECT', 'BATAM', 'BATAM', '29444', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU97', 'EUP-PROJ SINTANG', 'MILL PROJECT', 'SINTANG', 'SINTANG', '78613', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU98', 'EUP-PROJ MERAUKE', 'MILL PROJECT', 'MERAUKE', 'MERAUKE', '99613', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU99', 'EUP-PROJ BAGENDANG', 'MILL PROJECT', 'BAGENDANG', 'BAGENDANG', '74361', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU9A', 'EUP PROJ BIOMASS LUBUK GAUNG', 'SPECIAL MILL PROJECT', 'LUBUK GAUNG', 'DUMAI', '28826', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU9B', 'EUP PROJ BIOMASS BONTANG', 'SPECIAL MILL PROJECT', 'BONTANG', 'BONTANG', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU9C', 'EUP PROJ BIOMASS TJ.PURA', 'SPECIAL MILL PROJECT', 'TANJUNG PURA', 'TANJUNG PURA', '78371', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU9D', 'EUP PROJ BIOMASS KUMAI', 'SPECIAL MILL PROJECT', 'KUMAI', 'KUMAI', '74181', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU9E', 'EUP PROJ BIOMASS PALEMBANG', 'SPECIAL MILL PROJECT', 'PALEMBANG', 'PALEMBANG', '30961', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU9F', 'EUP PROJ BIOMASS BOVENDIGUL', 'MILL PROJECT', 'BOVENDIGUL', 'PAPUA', NULL, 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU9X', 'EUP PROJ JAMBI', 'MILL PROJECT', 'JAMBI', 'JAMBI', '75325', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EU9Y', 'EUP PROJ PAYA PASIR', 'MILL PROCESS', 'PAYA PASIR', 'PAYA PASIR', '20255', 'DWS ONLY'),
  ('EU', 'PT ENERGI UNGGUL PERSADA', 'EUL0', 'EUP TRADING PLANT INTERDIVISION', 'HO TRADING INTERDIVISION', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('GM', 'Gulf Lubes Malaysia Sdn Bhd', 'GM00', 'GLM HEAD OFFICE MALAYSIA', 'HO GENERAL', 'SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920', 'DWS ONLY'),
  ('GM', 'Gulf Lubes Malaysia Sdn Bhd', 'GM10', 'GLM TRADING PLANT', 'HO TRADING', 'SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920', 'DWS ONLY'),
  ('GM', 'Gulf Lubes Malaysia Sdn Bhd', 'GM21', 'GLM REFINERY PORT KLANG', 'MILL PROCESS', 'SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920', 'SAP & DWS'),
  ('GM', 'Gulf Lubes Malaysia Sdn Bhd', 'GM2A', 'GLM BIOENERGY PORT KLANG', 'MILL PROCESS', 'SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920', 'DWS ONLY'),
  ('GM', 'Gulf Lubes Malaysia Sdn Bhd', 'GM90', 'GLM PROJ HEAD OFFICE MALAYSIA', 'HO PROJECT', 'SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920', 'DWS ONLY'),
  ('GM', 'Gulf Lubes Malaysia Sdn Bhd', 'GM91', 'GLM PROJ REFINERY PORT KLANG', 'MILL PROJECT', 'SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920', 'DWS ONLY'),
  ('GM', 'Gulf Lubes Malaysia Sdn Bhd', 'GM9A', 'GLM PROJ BIOENERGY PORT KLANG', 'MILL PROJECT', 'SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920', 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP00', 'JPN GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP10', 'JPN TRADING PLANT', 'HO TRADING', 'TANGERANG', 'DKI JAKARTA', '12980', 'SAP & DWS'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP21', 'JPN ANIMAL FEED BEKASI', 'MILL PROCESS', 'BEKASI', 'BEKASI', '17131', 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP22', 'JPN ANIMAL FEED SIDOARJO', 'MILL PROCESS', 'SIDOARJO', 'SIDOARJO', NULL, 'SAP & DWS'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP26', 'JPN ANIMAL FEED GRESIK', 'MILL PROCESS', 'GRESIK', 'GRESIK', '61119', 'SAP & DWS'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP27', 'JPN ANIMAL FEED LUBUK GAUNG', 'MILL PROCESS', 'LUBUK GAUNG', 'RT. 001 RW.00, BANGSAL ACEH', '28826', 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP90', 'JPN PROJ HO', 'HO PROJECT', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP91', 'JPN PROJ BEKASI', 'MILL PROJECT', 'BEKASI', 'BEKASI', '17131', 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP92', 'JPN PROJ SIDOARJO', 'MILL PROJECT', 'SIDOARJO', 'SIDOARJO', NULL, 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP96', 'JPN PROJ ANIMAL FEED GRESIK', 'PROJECT', 'GRESIK', 'GRESIK', '61119', 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JP97', 'JPN PROJ ANIMAL FEED LUBUK GAUNG', 'PROJECT', 'LUBUK GAUNG', 'RT. 001 RW.00, BANGSAL ACEH', '28826', 'DWS ONLY'),
  ('JP', 'PT. JATI PERKASA NUSANTARA', 'JPL0', 'JPN TRADING PLANT INTERDIVISION', 'HO TRADING INTERDIVISION', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('PM', 'PT Prima Makmur Cakrawala', 'PM00', 'PMC GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'JAKARTA SELATAN', '12940', 'DWS ONLY'),
  ('PM', 'PT Prima Makmur Cakrawala', 'PM10', 'PMC TRADING HO JAKARTA', 'HO TRADING', 'JAKARTA', 'JAKARTA SELATAN', '12940', 'DWS ONLY'),
  ('PM', 'PT Prima Makmur Cakrawala', 'PM21', 'PMC BIOENERGY LB.GAUNG', 'BIOENERGY', 'LUBUK GAUNG', 'DUMAI', '28826', 'SAP & DWS'),
  ('PM', 'PT Prima Makmur Cakrawala', 'PM90', 'PMC PROJ HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'JAKARTA SELATAN', '12940', 'DWS ONLY'),
  ('PM', 'PT Prima Makmur Cakrawala', 'PM91', 'PMC PROJ LB.GAUNG', 'BIOENERGY', 'LUBUK GAUNG', 'DUMAI', '28826', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS00', 'PRISCOLIN GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS10', 'PRISCOLIN TRADING PLANT', 'HO TRADING', 'KARAWANG', 'DKI JAKARTA', '12980', 'SAP & DWS'),
  ('PS', 'PT Priscolin', 'PS21', 'PRC PALM & LAURIC BEKASI', 'MILL PROCESS', 'BEKASI', 'BEKASI', '17131', 'SAP & DWS'),
  ('PS', 'PT Priscolin', 'PS22', 'PRC PREMIXED BEKASI', 'MILL PROCESS', 'BEKASI', 'BEKASI', '17131', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS23', 'PRC PALM & LAURIC KARAWANG', 'MILL PROCESS', 'KARAWANG', 'KARAWANG', '41361', 'SAP & DWS'),
  ('PS', 'PT Priscolin', 'PS24', 'PRISCOLIN EDIBLE OIL TJ.PRIOK', 'MILL PROCESS', 'KARAWANG', 'KARAWANG', NULL, 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS2A', 'PRC SPECIALITY F&S KARWNG OLD', 'MILL PROCESS', 'KARAWANG', 'KARAWANG', '41361', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS2B', 'PRC OLEO CHEMICAL KARAWANG', 'MILL PROCESS', 'KARAWANG', 'KARAWANG', '41361', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS4A', 'PRC SPECIALITY F&S KARAWANG', 'MILL PROCESS', 'KARAWANG', 'KARAWANG', '41361', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS4B', 'PRC OLEO CHEMICAL KARAWANG', 'MILL PROCESS', 'KARAWANG', 'KARAWANG', '41361', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS8A', 'PRC PROJ OLEO KARAWANG', 'MILL PROJECT', 'KARAWANG', 'KARAWANG', '41361', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS90', 'PRISCOLIN PROJ HO JAKARTA', 'HO PROJECT', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS91', 'PRISCOLIN PROJ BEKASI', 'MILL PROJECT', 'BEKASI', 'BEKASI', '17131', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS93', 'PRC PROJ KARAWANG OLD', 'MILL PROJECT', 'KARAWANG', 'KARAWANG', '41361', 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PS94', 'PRC PROJ TJ.PRIOK', 'PROJECT', 'KARAWANG', NULL, NULL, 'DWS ONLY'),
  ('PS', 'PT Priscolin', 'PSL0', 'PRC TRADING PLANT INTERDIVISION', 'HO TRADING INTERDIVISION', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('RB', 'PT RIAU SEMESTA BIOMASSA', 'RB00', 'RSB GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'DKI JAKARTA', '10350', 'DWS ONLY'),
  ('RB', 'PT RIAU SEMESTA BIOMASSA', 'RB10', 'RSB TRADING PLANT', 'HO TRADING', 'RIAU', 'DKI JAKARTA', '10350', 'SAP & DWS'),
  ('RB', 'PT RIAU SEMESTA BIOMASSA', 'RB21', 'RSB BIOMASS TJ.BUTON', 'MILL PROCESS', 'TANJUNG BUTON', 'PEKAN BARU', '28662', 'SAP & DWS'),
  ('RB', 'PT RIAU SEMESTA BIOMASSA', 'RB90', 'RSB PROJ HO JAKARTA', 'HO PROJECT', 'JAKARTA', 'DKI JAKARTA', '10350', 'DWS ONLY'),
  ('RB', 'PT RIAU SEMESTA BIOMASSA', 'RB91', 'RSB PROJ BIOMASS TJ.BUTON', 'MILL PROJECT', 'TANJUNG BUTON', 'PEKAN BARU', '28662', 'DWS ONLY'),
  ('RI', 'PT Royal Foods Indonesia', 'RI00', 'RFI GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('RI', 'PT Royal Foods Indonesia', 'RI10', 'RFI TRADING PLANT', 'HO TRADING', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('RI', 'PT Royal Foods Indonesia', 'RI21', 'RFI GENERAL BEKASI', 'MILL PROCESS', 'BEKASI', 'BEKASI', '17131', 'SAP & DWS'),
  ('RI', 'PT Royal Foods Indonesia', 'RI90', 'RFI PROJ HO JAKARTA', 'HO PROJECT', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('RI', 'PT Royal Foods Indonesia', 'RI91', 'RFI PROJ BEKASI', 'MILL PROJECT', 'BEKASI', 'BEKASI', '17131', 'DWS ONLY'),
  ('RI', 'PT Royal Foods Indonesia', 'RIL0', 'RFI TRADING PLANT INTERDIVISION', 'HO TRADING INTERDIV', 'JAKARTA', 'DKI JAKARTA', '12980', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC00', 'SPC GENERAL HO JAKARTA', 'HO GENERAL', 'JAKARTA', 'JAKARTA', '12980', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC10', 'SPC TRADING PLANT', 'HO TRADING', 'LUBUK GAUNG', 'JAKARTA', '12980', 'SAP & DWS'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC21', 'SPC PALM & LAURIC BATAM', 'MILL PROCESS', 'BATAM', 'KEPULAUAN RIAU BATAM', '29444', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC22', 'SPC PALM & LAURIC LB.GAUNG', 'MILL PROCESS', 'LUBUK GAUNG', 'DUMAI', '28826', 'SAP & DWS'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC4A', 'SPC BIODIESEL BATAM', 'MILL PROCESS', 'BATAM', 'KEPULAUAN RIAU BATAM', '29444', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC4B', 'SPC BIODIESEL LB.GAUNG', 'MILL PROCESS', 'LUBUK GAUNG', 'DUMAI', '28826', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC8A', 'SPC PROJ BIODIESEL BATAM', 'MILL PROJECT', 'BATAM', 'KEPULAUAN RIAU BATAM', '29444', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC8B', 'SPC PROJ BIODIESEL LB.GAUNG', 'MILL PROJECT', 'LUBUK GAUNG', 'DUMAI', '28826', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC90', 'SPC PROJ HO JAKARTA', 'HO PROJECT', 'JAKARTA', 'JAKARTA', '12980', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC91', 'SPC PROJ BATAM', 'MILL PROJECT', 'BATAM', 'KEPULAUAN RIAU BATAM', '29444', 'DWS ONLY'),
  ('SC', 'PT Sumber Pangan Cemerlang', 'SC92', 'SPC PROJ LB.GAUNG', 'MILL PROJECT', 'LUBUK GAUNG', 'DUMAI', '28826', 'DWS ONLY'),
  ('TP', 'TPG Oil & Gas Sdn Bhd', 'TP00', 'TPG GENERAL HO MALAYSIA', 'HO GENERAL', 'PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700', 'DWS ONLY'),
  ('TP', 'TPG Oil & Gas Sdn Bhd', 'TP10', 'TPG TRADING PLANT', 'HO TRADING', 'PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700', 'DWS ONLY'),
  ('TP', 'TPG Oil & Gas Sdn Bhd', 'TP21', 'TPG PALM & LAURIC TJ.LANGSAT', 'MILL PROCESS', 'PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700', 'SAP & DWS'),
  ('TP', 'TPG Oil & Gas Sdn Bhd', 'TP2A', 'TPG BIODIESEL TJ.LANGSAT', 'MILL PROCESS', 'PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700', 'DWS ONLY'),
  ('TP', 'TPG Oil & Gas Sdn Bhd', 'TP90', 'TPG PROJECT HO MALAYSIA', 'HO PROJECT', 'PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700', 'DWS ONLY'),
  ('TP', 'TPG Oil & Gas Sdn Bhd', 'TP91', 'TPG PROJ PALMLAURIC TJ.LANGSAT', 'MILL PROJECT', 'PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700', 'DWS ONLY'),
  ('TP', 'TPG Oil & Gas Sdn Bhd', 'TP9A', 'TPG PROJ BIOENERGY TJ.LANGSAT', 'MILL PROJECT', 'PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700', 'DWS ONLY');

-- 1. Master Company (Internal) ------------------------------------------------------------------------------
CREATE TEMP TABLE company_map ON COMMIT DROP AS
SELECT f.company_code,
       COALESCE(
         (SELECT c.id FROM master_companies c WHERE upper(btrim(c.company_code)) = upper(f.company_code) LIMIT 1),
         (SELECT c.id FROM master_companies c WHERE regexp_replace(regexp_replace(upper(btrim(c.company_name)), '[^A-Z0-9 ]', '', 'g'), '\s+', ' ', 'g') = regexp_replace(regexp_replace(upper(btrim(f.company_name)), '[^A-Z0-9 ]', '', 'g'), '\s+', ' ', 'g')
           ORDER BY (c.code_dhm IS NULL), c.code_dhm LIMIT 1)
       ) AS id
FROM final_companies f;

UPDATE master_companies c
   SET company_code = f.company_code, company_name = f.company_name, updated_at = CURRENT_TIMESTAMP
  FROM company_map m
  JOIN final_companies f ON f.company_code = m.company_code
 WHERE c.id = m.id
   AND (c.company_code IS DISTINCT FROM f.company_code OR c.company_name IS DISTINCT FROM f.company_name);

INSERT INTO master_companies (company_code, company_name)
SELECT f.company_code, f.company_name
  FROM final_companies f JOIN company_map m ON m.company_code = f.company_code
 WHERE m.id IS NULL;

UPDATE company_map m
   SET id = c.id
  FROM master_companies c
 WHERE m.id IS NULL AND upper(btrim(c.company_code)) = upper(m.company_code);

DELETE FROM master_companies WHERE id NOT IN (SELECT id FROM company_map);

-- 2. Master Site: add what is missing (an existing Site keeps its City and postal code) ----------------------
INSERT INTO master_sites (site_name, city, postal_code)
SELECT s.site_name, s.city, s.postal_code
  FROM final_sites s
 WHERE NOT EXISTS (SELECT 1 FROM master_sites m WHERE upper(btrim(m.site_name)) = upper(s.site_name));

-- 3. Master Plant: one row per plant code, then match, add, remove ----------------------------------------
DELETE FROM master_plants p
 USING (SELECT id, row_number() OVER (PARTITION BY upper(btrim(plant_code)) ORDER BY (code_dhm IS NULL), created_at) AS rn
          FROM master_plants) d
 WHERE p.id = d.id AND d.rn > 1;

UPDATE master_plants p
   SET company_code = f.company_code, company_name = f.company_name, plant_name = f.plant_name,
       plant_type = f.plant_type, site = f.site_name, site_id = s.id, city = f.city,
       postal_code = f.postal_code, found_in = f.found_in, updated_at = CURRENT_TIMESTAMP
  FROM final_plants f
  LEFT JOIN master_sites s ON upper(btrim(s.site_name)) = upper(f.site_name)
 WHERE upper(btrim(p.plant_code)) = upper(f.plant_code);

INSERT INTO master_plants (company_code, company_name, plant_code, plant_name, plant_type, site, site_id, city, postal_code, found_in)
SELECT f.company_code, f.company_name, f.plant_code, f.plant_name, f.plant_type, f.site_name, s.id, f.city, f.postal_code, f.found_in
  FROM final_plants f
  LEFT JOIN master_sites s ON upper(btrim(s.site_name)) = upper(f.site_name)
 WHERE NOT EXISTS (SELECT 1 FROM master_plants p WHERE upper(btrim(p.plant_code)) = upper(f.plant_code));

DELETE FROM master_plants p
 WHERE NOT EXISTS (SELECT 1 FROM final_plants f WHERE upper(f.plant_code) = upper(btrim(p.plant_code)));

-- 4. Master Site: remove the Sites the sheet does not use (plants no longer point at them) -------------------
DELETE FROM master_sites s
 WHERE NOT EXISTS (SELECT 1 FROM final_sites f WHERE upper(f.site_name) = upper(btrim(s.site_name)));

-- 5. Company <-> Site links, rebuilt from the plants ---------------------------------------------------------
DELETE FROM master_company_sites;
INSERT INTO master_company_sites (company_id, site_id)
SELECT m.id, s.id
  FROM final_company_sites p
  JOIN company_map m ON m.company_code = p.company_code
  JOIN master_sites s ON upper(btrim(s.site_name)) = upper(p.site_name)
ON CONFLICT DO NOTHING;
