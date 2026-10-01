-- Link the Sites that belong to PT ENERGI UNGGUL PERSADA to it, by NAME instead of by code.
--
-- Migrations 204 (seed), 211 and 214 linked Sites to companies by company_code, and the sheet calls this company
-- EU. On SIT there is no company EU: Master Company (Internal) holds it as EUP, "PT. Energi Unggul Persada",
-- DHM code ORG-0002 (the code and the spelling came from DHM). Every EU pair was skipped without a word, so these
-- Sites have no company at all and cannot be pushed to DHM ("Site needs a DHM company"), and the plants on them
-- stop at "Plant needs a DHM site. Sync Master Site first.":
--   BATAM, KUMAI, PALEMBANG, TANJUNG PURA          restored by 211
--   BAGENDANG, BOVENDIGUL, JAMBI, PAYA PASIR, SINTANG   added by 214
--
-- Pairs are the EU ones of migration 204 plus the five new places that only EU uses on the sheet. The company is
-- found by name with dots, case and repeated spaces ignored, so it matches EU "PT ENERGI UNGGUL PERSADA" on a
-- database that has the code EU and EUP "PT. Energi Unggul Persada" on SIT. If no company has that name nothing
-- is inserted.
--
-- Additive and idempotent. A Site that already has other companies keeps them.

INSERT INTO master_company_sites (company_id, site_id)
SELECT company.id, site.id
FROM (VALUES
  ('BATAM'), ('BONTANG'), ('KARAWANG'), ('KUMAI'), ('LUBUK GAUNG'), ('PALEMBANG'), ('TANJUNG PURA'),
  ('MERAUKE'), ('BOVENDIGUL'), ('SINTANG'), ('PAYA PASIR'), ('BAGENDANG'), ('JAMBI')
) AS pair(site_name)
JOIN master_companies company
  ON regexp_replace(regexp_replace(upper(btrim(company.company_name)), '[^A-Z0-9 ]', '', 'g'), '\s+', ' ', 'g')
     = 'PT ENERGI UNGGUL PERSADA'
JOIN master_sites site ON upper(trim(site.site_name)) = pair.site_name
ON CONFLICT DO NOTHING;
