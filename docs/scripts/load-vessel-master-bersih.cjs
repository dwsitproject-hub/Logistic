/**
 * Load the cleaned tug (TB) and barge (BG) vessels, and the pairs they form, into KLIP's Master Vessel - and push them to DHM.
 * Source: "Vessel Cleanup (Jovin, Klip, SAP) v2.xlsx", sheet Vessel_Master_Bersih (rows "Siap", plus any held row whose "Nama final"
 * was filled in). The data is embedded below; regenerate this file with docs/scripts/build-vessel-load-script.py after the sheet changes.
 *
 * Needs migration 230 (vessel_role, vessel_pairs): deploy the backend first. Nothing here runs from the deploy script - it is a step you
 * choose to run, per environment.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/load-vessel-master-bersih.cjs \
 *     | docker exec -i klip-backend node -                      # 1. dry run: reads only, prints what would happen
 *   ... | docker exec -i klip-backend node - --apply            # 2. load into master_vessels / vessel_pairs (one transaction)
 *   ... | docker exec -i klip-backend node - --push-dhm         # 3. push the vessels in this file to DHM (after step 2)
 *   ... | docker exec -i klip-backend node - --apply --push-dhm # 2 and 3 together
 *   add --rename-existing to 2 to give the vessels that are ALREADY in the master the clean name of the sheet (the dry run lists which)
 *
 * Rules it follows
 *  - A vessel whose base name already exists in the master is REUSED: only its empty fields are filled (owner, capacity, type, heating,
 *    lambung, charter, role); nothing is overwritten - its NAME is changed only with --rename-existing.
 *  - The same vessel written twice in the file (HADI I / HADI 1) is loaded once; both spellings point at the same master row. A tug and a barge that share a base name once TB./BG. is stripped are reported as a
 *    conflict and skipped, never merged.
 *  - A SAP code is attached only when no other vessel holds it. A held code is reported and left where it is.
 *  - A vessel with no code becomes PROVISIONAL (TMP- placeholder); the SAP import promotes it when it brings the same name with a code.
 *  - Re-running is safe: vessels are matched by name, pairs by pair code.
 *  - DHM: a tug is sent with the Hub's own tug value in Vessel_Type when the Hub's enum has one, otherwise without a type. The summary
 *    says which. A TMP- placeholder is never sent as a SAP code.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const DATA = {
 "vessels": [
  {
   "role": "TB",
   "name": "TB. ARGO 10",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SOLID 10",
   "codes": [],
   "owner": "PELAYARAN ARGO MITRA SUKSES PT.",
   "capacity": 2500,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BAHTERA 7",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CIPTA JAYA X",
   "codes": [],
   "owner": "MUTIARANUSA ANTARSAMUDERA LINES PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. AREK SUROBOYO 3",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BOSS 3",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. BIMA SAKTI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. HM 2301",
   "codes": [],
   "owner": null,
   "capacity": 2000,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. KALTIM DOLPHIN 1011",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. KALTIM",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. ELIZABETH",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ASL 78",
   "codes": [],
   "owner": "SAMUDERA AMAN SENTOSA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. ENTEBE EMERALD 69",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TOL LANDAK VII",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. FT VI",
   "codes": [],
   "owner": "MULIA BORNEO MANDIRI PT.",
   "capacity": 3000,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. MAXIMUS 710",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LUMINOR 5",
   "codes": [
    "MBGLUMINO5",
    "MLUM5",
    "MLUMIN5"
   ],
   "owner": "MAXIMA LINERS PT.",
   "capacity": 4000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. AS MARINA 9",
   "codes": [
    "MMARINA03"
   ],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. AS MARINA 12",
   "codes": [
    "MMAR12",
    "MMARINA12",
    "MMMARINA12"
   ],
   "owner": "MAXIMA LINERS PT.",
   "capacity": 3000,
   "vesselType": "BARGE",
   "heating": true,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. AS MARINA 11",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. AS MARINA 10",
   "codes": [
    "MMAR10",
    "MMARINA10"
   ],
   "owner": "MAXIMA LINERS PT.",
   "capacity": 3000,
   "vesselType": "BARGE",
   "heating": true,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. MARINA MERCURY 2",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LUMINOR 6",
   "codes": [
    "MBGLUMINO6",
    "MLUM6",
    "MLUMI"
   ],
   "owner": "MAXIMA LINERS PT.",
   "capacity": 4000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. MITRA KENCANA",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SBR KENCANA XV",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. SHIENNY",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. RHONDA",
   "codes": [
    "MRHONDA"
   ],
   "owner": "ANGGAMEDA SAMUDRA LINE PT.",
   "capacity": 1500,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. AREK SUROBOYO 1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BOSS 1",
   "codes": [],
   "owner": "SAMUDERA AMAN SENTOSA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. TALES",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BUKIT BERIAN",
   "codes": [],
   "owner": null,
   "capacity": 3500,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TEBAR",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. TIGA JAYA 58",
   "codes": [],
   "owner": null,
   "capacity": 4000,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TOLLANDAK II",
   "codes": [
    "MLANDAK2"
   ],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. JAYASEJAHTERA I",
   "codes": [],
   "owner": "MULIA BORNEO MANDIRI PT.",
   "capacity": 2500,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. ANUGRAH LESTARI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ANUGRAH",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MARINA 2215",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MARINE POWER 3062",
   "codes": [],
   "owner": "SAMUDERA AMAN SENTOSA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. ARTHA 08",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ASM 08",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. ASP GLORY",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ROYAL PALMA 10",
   "codes": [
    "MROYAL10"
   ],
   "owner": "CIF",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. AZIZAH",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. HELLY",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. KAWAN KITA",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SINAR BAHAGIA 02",
   "codes": [
    "MSINAR"
   ],
   "owner": "ARMADA ANAK LAUT PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BAHERA C169",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MAJU C169",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. JEEMS TRANSPORT",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MAS LINES 101",
   "codes": [
    "MMASLINES1"
   ],
   "owner": "ANUGERAH BAHARI MAS PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BATARA VII",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SINAR KOTA BESI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. BBS 1509",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. PROVINCE",
   "codes": [],
   "owner": "GEBARI MEDAN SEGARA PT.",
   "capacity": 5000,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BEATRICE 01",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. PON 1",
   "codes": [],
   "owner": "BINTANG BAHARI JAYA CV.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BERANTAS 07",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. GABRIELA II",
   "codes": [],
   "owner": "GEBARI MEDAN SEGARA PT.",
   "capacity": 2000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. EVER OCEAN SILK",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. EVER GIANT",
   "codes": [],
   "owner": "PENGANGKUTAN KEKAL SDN BHD PT.",
   "capacity": 3250,
   "vesselType": "BARGE",
   "heating": true,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. EVER GORGEOUS",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. EVER MILLION",
   "codes": [
    "MEVERMIL"
   ],
   "owner": "PENGANGKUTAN KEKAL SDN BHD PT.",
   "capacity": 2000,
   "vesselType": "BARGE",
   "heating": true,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. MAXIMUS 711",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LUMINOR 10",
   "codes": [
    "MLUM10",
    "MLUMIN10"
   ],
   "owner": "MAXIMA LINERS PT.",
   "capacity": 5000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. OPTIMUS 723",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LUMINOR 8",
   "codes": [
    "MBGLUMINOR",
    "MBLUMINOR8",
    "MLUM8"
   ],
   "owner": "MAXIMA LINERS PT.",
   "capacity": 4000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. OPTIMUS 722",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LUMINOR 9",
   "codes": [
    "MLUM9",
    "MLUMIN9",
    "MMLUMINOR9"
   ],
   "owner": "MAXIMA LINERS PT.",
   "capacity": 4000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. AS WARRIOR 5",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. AS WARRIOR 6",
   "codes": [
    "MWARR6"
   ],
   "owner": "MAXIMA LINERS PT.",
   "capacity": 4000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BINA MARINE 89",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BINA MARINE 90",
   "codes": [],
   "owner": "SAMUDERA AMAN SENTOSA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BINTANG POWER 09",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. FINACIA 60",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. BINTANG ANGKASA",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MELLEDANG 108",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. BINTANG POWER",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BARAMAR 3010",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. BIWIN 10",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BIL 05",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. HADI I",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MARINI I",
   "codes": [
    "MMARINI1"
   ],
   "owner": "BARUNA MANDALA RAYA PT.",
   "capacity": 3000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. BMJ 8",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BAHARI JAYA 9",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. BMS 004",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BMS 004A",
   "codes": [],
   "owner": "CIF",
   "capacity": 5000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BMS 03",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. KSD 12",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. SB91",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SAMUDRA BINTAN 2501",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. BRAHMA 11",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ALRAI",
   "codes": [],
   "owner": "RARA DUTA ARMADA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "BG",
   "name": "BG. TUNGGADEWI I",
   "codes": [
    "MTUNGGADEW"
   ],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. PANCARAN IV 915",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BUANA 4501",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA 5B",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CBS 2303",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA MALINDO V",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CBS 2306",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA 02",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CITRA2502",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA 03",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CITRA 2503",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA 07",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CITRA 45001",
   "codes": [
    "MCITRA45"
   ],
   "owner": "CITRA MARITIME PT.",
   "capacity": 4500,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. CITRA 09",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CITRA 3003",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA MAKMUR 235",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. OV-1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA 60",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CITRA 2501",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA 82",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CITRA 3312",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. CITRA MURNI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SAMUDERA IX",
   "codes": [],
   "owner": "SAMUDERA AMAN SENTOSA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. DABO 7",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MARINE POWER 2321",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. DB 3",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. WKA 4",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. ENDEAVOR 2",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. PACIFIC HARMONY",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. HIKMAH 02",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. FORTUNA ANDRE 001",
   "codes": [],
   "owner": "FORTUNA ANDRE LINES PT.",
   "capacity": 2000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. KALTIM DOLPHIN",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. KALTIM FT3601",
   "codes": [],
   "owner": "SAMUDERA AMAN SENTOSA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. AS JAYA 6",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. AS GLORY 16",
   "codes": [
    "MGLORY16"
   ],
   "owner": "KAPUAS ARMADA NUSANTARA",
   "capacity": 5000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. GLOBAL MARINE 02",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. GLORY 99",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SAHABAT KAPUAS B1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. HADI 1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MARINI 1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. HIKMAH -1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. WELLY 1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. JEAN",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. DEWI MURNI",
   "codes": [],
   "owner": "BINTANG BAHARI JAYA CV.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. EVER ALPHA",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. EVER JUPI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SAHABAT KAPUAS IV",
   "codes": [
    "MSAHAB4"
   ],
   "owner": "PELAYARAN SAHABAT KAPUAS PT.",
   "capacity": 3500,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. GOLDEN HAND",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. KAPUAS 118",
   "codes": [],
   "owner": "PELAYARAN SHERIN KAPUAS RAYA PT.",
   "capacity": 2000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. KARYODHI 2",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. KPS 1310",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. KSD 27",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. KSD 28",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MAXIMUS 777",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. HERMES 1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LUMINOR 3",
   "codes": [],
   "owner": "PT. ANUGRAH PRIMA SAMUDERA",
   "capacity": 4000,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. MEGA 09",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MAKMUR ABADI XVII",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MACALLAN 6",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LAFITE",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MARINA 1221",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MARINE POWER 2319",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. AS MARINA 1",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MARINA 2",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. HADI II",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MARINI II",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MASLINES 1003",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MAXIMUS 809",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. AS GLORY 6",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. OSEANIK 02",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MEL 01",
   "codes": [],
   "owner": "LAYAR OSEANIK MANDIRI PT.",
   "capacity": 3500,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. MELATI BARU 4",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ROBBY 44",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MILLENIUM",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. PUTRA MUSI",
   "codes": [
    "MPUTMUS",
    "MPUTRAMUSI"
   ],
   "owner": "PAYUNG SAMUDRA PT.",
   "capacity": 3500,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. MITRA KENCANA 5",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MITRA JAYA II",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SBU 88",
   "codes": [
    "MSBU88"
   ],
   "owner": "PELAYARAN SAHABAT KAPUAS PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. MITRA 227",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SEJAHTERA D12",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MITRA JAYA III",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MITRA JAYA IX",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MITRA JAYA XVIII",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. MODALWAN 1063",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ASIAPRIDE 2350",
   "codes": [],
   "owner": "ATLANTIC NUSA LINESS PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. MODALWAN NO 8",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. TC 2301",
   "codes": [],
   "owner": "DWI KANAYA SAMUDERA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. NUR HIDAYAH 1101",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. NUR HIDAYAH",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. ONI XII",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ILIR JAYA",
   "codes": [],
   "owner": "ONI PT.",
   "capacity": 6000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. OZONE 88",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. KARYA PACIFIC 2282",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. PACIFIC",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TRANS PACIFIC 66",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TIRTA BAHARI 03",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. PRIMA 91",
   "codes": [],
   "owner": "PELAYARAN SETIAKAWAN MAKMUR BERSAMA PT.",
   "capacity": 2200,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. PRIMA SAKTI VI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. PRIMA SAKTI VIII",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. PRIMA SAKTI IX",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. SBA 01",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SIAK BAHAGIA",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. SDS 44",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. CITEURUP 2",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. SEA DOLPHIN",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. APOLLO SUPER II",
   "codes": [],
   "owner": "J&Y TRANSHIPMENT PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. SEBESI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SEBUKU",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. PRATAMA V",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SEJAHTERA MAKMUR V",
   "codes": [],
   "owner": "CIF",
   "capacity": 3500,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. ANUGRAH 17",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SENTOSA JAYA 2307",
   "codes": [],
   "owner": "SAMUDERA AMAN SENTOSA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. PACIFIC STAR I",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SHERIN 03",
   "codes": [
    "MMSERIN03",
    "MSHERIN"
   ],
   "owner": "DUTA PERSADA KHATULISTIWA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. SAMUDRA SINDO 26",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. ARIEL T XI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SAHABAT KAPUAS MANDIRI XXIX",
   "codes": [
    "MSAHAB29"
   ],
   "owner": "PELAYARAN SAHABAT KAPUAS PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. SAHABAT KAPUAS UTAMA III",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LA",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. SINGSING 18",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SMB 9",
   "codes": [
    "MBG.SMB9",
    "MSMB9"
   ],
   "owner": "PELAYARAN SETIAKAWAN MAKMUR BERSAMA PT.",
   "capacity": 4500,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "SHSB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. SMT 1601",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MARITIME LADY",
   "codes": [],
   "owner": "SAMUDERA AMAN SENTOSA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. STK PRIMA 5",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. STK MERLION 111",
   "codes": [],
   "owner": "ABADI ENERGI NABATI PT.",
   "capacity": 2500,
   "vesselType": "BARGE",
   "heating": true,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. AREK SUROBOYO 02",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BOSS 02",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TANIMAS",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. TANIMAS MARINE",
   "codes": [],
   "owner": "TANIMAS MARITIM INDONESIA PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. BSI III",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. BSI II",
   "codes": [],
   "owner": "BERJAYA SAMUDERA INDONESIA PT.",
   "capacity": 5000,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. TN 115",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. OB TN 115",
   "codes": [],
   "owner": "TRIPATRA NUSANTARA PT.",
   "capacity": 2000,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. TELUK BAJAU DELTA",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SMS 3002",
   "codes": [
    "MSMS3002"
   ],
   "owner": "LINTAS MARITIM INDONESIA PT.",
   "capacity": 2650,
   "vesselType": "BARGE",
   "heating": false,
   "lambung": "DHDB",
   "terms": "T/C"
  },
  {
   "role": "TB",
   "name": "TB. TOB 21",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TOB 23",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. MANNALINE 9003",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TOB 26",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TRANSPOWER 166",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. GOLDTRANS 3008",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TRANS POWER 219",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TRANSPOWER 245",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. GOLDTRANS 3002",
   "codes": [],
   "owner": "DUTA RARA BORNEO LINE PT.",
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": "V/C"
  },
  {
   "role": "TB",
   "name": "TB. TRANS PACIFIC 99",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TRANS POWER 212",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. GOLD TRANS",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. TRIN POWER",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. LABROY 195",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "TB",
   "name": "TB. OCEAN VENTURE III",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "TUG BOAT",
   "heating": null,
   "lambung": null,
   "terms": null
  },
  {
   "role": "BG",
   "name": "BG. SAMUDRA XI",
   "codes": [],
   "owner": null,
   "capacity": null,
   "vesselType": "BARGE",
   "heating": null,
   "lambung": null,
   "terms": null
  }
 ],
 "pairs": [
  {
   "pairCode": "TBG-001",
   "tb": "TB. ARGO 10",
   "bg": "BG. SOLID 10",
   "firstContractDate": "2026-01-30",
   "lastContractDate": "2026-01-30",
   "sapRows2026": 1,
   "note": null,
   "sapNames": [
    "TB ARGO 10/BG SOLID 10"
   ]
  },
  {
   "pairCode": "TBG-002",
   "tb": "TB. BAHTERA 7",
   "bg": "BG. CIPTA JAYA X",
   "firstContractDate": "2026-01-05",
   "lastContractDate": "2026-01-05",
   "sapRows2026": 1,
   "note": null,
   "sapNames": [
    "TB. BAHTERA 7/BG CIPTA JAYA X",
    "TB. BAHTERA 7 / BG. CIPTA JAYA X"
   ]
  },
  {
   "pairCode": "TBG-003",
   "tb": "TB. AREK SUROBOYO 3",
   "bg": "BG. BOSS 3",
   "firstContractDate": "2026-04-14",
   "lastContractDate": "2026-05-05",
   "sapRows2026": 4,
   "note": null,
   "sapNames": [
    "TB.AREK SUROBOYO 3/BG.BOSS 3"
   ]
  },
  {
   "pairCode": "TBG-004",
   "tb": "TB. BIMA SAKTI",
   "bg": "BG. HM 2301",
   "firstContractDate": "2026-05-25",
   "lastContractDate": "2026-05-25",
   "sapRows2026": 1,
   "note": null,
   "sapNames": [
    "TB.BIMA SAKTI/BG.HM 2301"
   ]
  },
  {
   "pairCode": "TBG-005",
   "tb": "TB. KALTIM DOLPHIN 1011",
   "bg": "BG. KALTIM",
   "firstContractDate": "2026-01-30",
   "lastContractDate": "2026-07-15",
   "sapRows2026": 4,
   "note": null,
   "sapNames": [
    "TB.KALTIM DOLPHIN 1011/BG. KALTIM"
   ]
  },
  {
   "pairCode": "TBG-006",
   "tb": "TB. ELIZABETH",
   "bg": "BG. ASL 78",
   "firstContractDate": "2026-01-05",
   "lastContractDate": "2026-07-30",
   "sapRows2026": 6,
   "note": null,
   "sapNames": [
    "TB. ELIZABETH / BG. ASL 78"
   ]
  },
  {
   "pairCode": "TBG-007",
   "tb": "TB. ENTEBE EMERALD 69",
   "bg": null,
   "firstContractDate": "2026-03-13",
   "lastContractDate": "2026-03-31",
   "sapRows2026": 4,
   "note": null,
   "sapNames": [
    "TB.ENTEBE EMERALD 69/BG. TIGA JAYA",
    "TB. ENTEBE EMERALD 69/BG. TIGA JAYA"
   ]
  },
  {
   "pairCode": "TBG-008",
   "tb": "TB. TOL LANDAK VII",
   "bg": "BG. FT VI",
   "firstContractDate": "2026-05-19",
   "lastContractDate": "2026-09-15",
   "sapRows2026": 3,
   "note": null,
   "sapNames": [
    "TB.TOL LANDAK VII/BG.FT VI"
   ]
  },
  {
   "pairCode": "TBG-009",
   "tb": "TB. MAXIMUS 710",
   "bg": "BG. LUMINOR 5",
   "firstContractDate": "2026-01-07",
   "lastContractDate": "2026-07-01",
   "sapRows2026": 15,
   "note": null,
   "sapNames": [
    "TB. MAXIMUS 710 / BG. LUMINOR 5",
    "TB.MAXIMUS 710/BG. LUMINOR 5"
   ]
  },
  {
   "pairCode": "TBG-010",
   "tb": "TB. AS MARINA 9",
   "bg": "BG. AS MARINA 12",
   "firstContractDate": "2026-01-15",
   "lastContractDate": "2026-09-08",
   "sapRows2026": 27,
   "note": null,
   "sapNames": [
    "TB. AS MARINA 9 / BG. AS MARINA 12",
    "TB. AS MARINA 9/BG AS MARINA 12"
   ]
  },
  {
   "pairCode": "TBG-011",
   "tb": "TB. AS MARINA 11",
   "bg": "BG. AS MARINA 10",
   "firstContractDate": "2026-04-10",
   "lastContractDate": "2026-07-31",
   "sapRows2026": 2,
   "note": null,
   "sapNames": [
    "TB. AS MARINA 11/BG AS MARINA 10",
    "TG AS MARINA 11 / BG AS MARINA 10 V"
   ]
  },
  {
   "pairCode": "TBG-012",
   "tb": "TB. MARINA MERCURY 2",
   "bg": null,
   "firstContractDate": "2026-07-08",
   "lastContractDate": "2026-07-24",
   "sapRows2026": 6,
   "note": null,
   "sapNames": [
    "TB.MARINA MERCURY 2/BG.DHANA BAHARI"
   ]
  },
  {
   "pairCode": "TBG-013",
   "tb": null,
   "bg": "BG. LUMINOR 6",
   "firstContractDate": "2026-04-06",
   "lastContractDate": "2026-05-15",
   "sapRows2026": 15,
   "note": "mungkin pasangan yang sama dengan TBG-037: ejaan TB mirip (TB. OPTIMUS 7)",
   "sapNames": [
    "TB. OPTIMUS 777/BG. LUMINOR 6"
   ]
  },
  {
   "pairCode": "TBG-014",
   "tb": "TB. MITRA KENCANA",
   "bg": "BG. SBR KENCANA XV",
   "firstContractDate": "2026-01-28",
   "lastContractDate": "2026-01-28",
   "sapRows2026": 1,
   "note": null,
   "sapNames": [
    "TB.MITRA KENCANA/BG.SBR KENCANA XV"
   ]
  },
  {
   "pairCode": "TBG-015",
   "tb": "TB. SHIENNY",
   "bg": "BG. RHONDA",
   "firstContractDate": "2026-06-30",
   "lastContractDate": "2026-08-14",
   "sapRows2026": 5,
   "note": null,
   "sapNames": [
    "TB.SHIENNY/BG.RHONDA"
   ]
  },
  {
   "pairCode": "TBG-016",
   "tb": "TB. AREK SUROBOYO 1",
   "bg": "BG. BOSS 1",
   "firstContractDate": "2026-02-13",
   "lastContractDate": "2026-02-20",
   "sapRows2026": 2,
   "note": null,
   "sapNames": [
    "TB. AREK SUROBOYO 1 /BG.BOSS 1"
   ]
  },
  {
   "pairCode": "TBG-017",
   "tb": "TB. TALES",
   "bg": "BG. BUKIT BERIAN",
   "firstContractDate": "2026-01-30",
   "lastContractDate": "2026-04-17",
   "sapRows2026": 2,
   "note": null,
   "sapNames": [
    "TB.TALES/BG.BUKIT BERIAN"
   ]
  },
  {
   "pairCode": "TBG-018",
   "tb": "TB. TEBAR",
   "bg": "BG. TIGA JAYA 58",
   "firstContractDate": "2026-07-31",
   "lastContractDate": "2026-09-04",
   "sapRows2026": 6,
   "note": null,
   "sapNames": [
    "TEBAR/BG.TIGA JAYA 58"
   ]
  },
  {
   "pairCode": "TBG-019",
   "tb": "TB. TOLLANDAK II",
   "bg": "BG. JAYASEJAHTERA I",
   "firstContractDate": "2026-01-15",
   "lastContractDate": "2026-01-15",
   "sapRows2026": 1,
   "note": null,
   "sapNames": [
    "TB.TOLLANDAK II/BG.JAYASEJAHTERA I"
   ]
  },
  {
   "pairCode": "TBG-020",
   "tb": "TB. ANUGRAH LESTARI",
   "bg": "BG. ANUGRAH",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "ANUGRAH LESTARI / BG. ANUGRAH"
   ]
  },
  {
   "pairCode": "TBG-021",
   "tb": "TB. MARINA 2215",
   "bg": "BG. MARINE POWER 3062",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.MARINA 2215/BG.MARINE POWER 3062"
   ]
  },
  {
   "pairCode": "TBG-022",
   "tb": "TB. ARTHA 08",
   "bg": "BG. ASM 08",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. ARTHA 08 / BG. ASM 08"
   ]
  },
  {
   "pairCode": "TBG-023",
   "tb": "TB. ASP GLORY",
   "bg": "BG. ROYAL PALMA 10",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. ASP GLORY/BG. ROYAL PALMA 10"
   ]
  },
  {
   "pairCode": "TBG-024",
   "tb": "TB. AZIZAH",
   "bg": "BG. HELLY",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.AZIZAH/BG.HELLY"
   ]
  },
  {
   "pairCode": "TBG-025",
   "tb": "TB. KAWAN KITA",
   "bg": "BG. SINAR BAHAGIA 02",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TK. SINAR BAHAGIA 02/TB.KAWAN KITA"
   ]
  },
  {
   "pairCode": "TBG-026",
   "tb": "TB. BAHERA C169",
   "bg": "BG. MAJU C169",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.BAHERA C169/BG.MAJU C169"
   ]
  },
  {
   "pairCode": "TBG-027",
   "tb": "TB. BAHTERA 7",
   "bg": "BG. JEEMS TRANSPORT",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; TB ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan",
   "sapNames": [
    "BAHTERA 7 / BG. JEEMS TRANSPORT"
   ]
  },
  {
   "pairCode": "TBG-028",
   "tb": "TB. BAHTERA 7",
   "bg": "BG. MAS LINES 101",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; TB ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan",
   "sapNames": [
    "BAHTERA 7 / BG. MAS LINES 101"
   ]
  },
  {
   "pairCode": "TBG-029",
   "tb": "TB. BATARA VII",
   "bg": "BG. SINAR KOTA BESI",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BATARA VII / BG. SINAR KOTA BESI"
   ]
  },
  {
   "pairCode": "TBG-030",
   "tb": "TB. BBS 1509",
   "bg": "BG. PROVINCE",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. BBS 1509 / BG. PROVINCE"
   ]
  },
  {
   "pairCode": "TBG-031",
   "tb": "TB. BEATRICE 01",
   "bg": "BG. PON 1",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. BEATRICE 01 / TKG. PON 1"
   ]
  },
  {
   "pairCode": "TBG-032",
   "tb": "TB. BERANTAS 07",
   "bg": "BG. GABRIELA II",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. BERANTAS 07 / BG. GABRIELA II"
   ]
  },
  {
   "pairCode": "TBG-034",
   "tb": "TB. EVER OCEAN SILK",
   "bg": "BG. EVER GIANT",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BG EVER GIANT/TB EVER OCEAN SILK"
   ]
  },
  {
   "pairCode": "TBG-035",
   "tb": "TB. EVER GORGEOUS",
   "bg": "BG. EVER MILLION",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB EVER GORGEOUS / BG EVER MILLION"
   ]
  },
  {
   "pairCode": "TBG-036",
   "tb": "TB. MAXIMUS 711",
   "bg": "BG. LUMINOR 10",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BG LUMINOR 10 / TB MAXIMUS 711",
    "BG. LUMINOR 10 / TB. MAXIMUS 711"
   ]
  },
  {
   "pairCode": "TBG-037",
   "tb": null,
   "bg": "BG. LUMINOR 6",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; mungkin pasangan yang sama dengan TBG-013: ejaan TB mirip (TB. OPTIMUS 777)",
   "sapNames": [
    "BG LUMINOR 6 V12/22 / TB OPTIMUS 7"
   ]
  },
  {
   "pairCode": "TBG-038",
   "tb": "TB. OPTIMUS 723",
   "bg": "BG. LUMINOR 8",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BG. LUMINOR 8/TB. OPTIMUS 723",
    "TB. OPTIMUS 723/BG. LUMINOR 8"
   ]
  },
  {
   "pairCode": "TBG-039",
   "tb": "TB. OPTIMUS 722",
   "bg": "BG. LUMINOR 9",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BG.LUMINOR 9 V23/22 /TB.OPTIMUS 722",
    "TB. OPTIMUS 722/BG. LUMINOR 9"
   ]
  },
  {
   "pairCode": "TBG-040",
   "tb": "TB. AS WARRIOR 5",
   "bg": "BG. AS WARRIOR 6",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. AS WARRIOR 5 / BG. AS WARRIOR 6"
   ]
  },
  {
   "pairCode": "TBG-041",
   "tb": "TB. BINA MARINE 89",
   "bg": "BG. BINA MARINE 90",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BINA MARINE 89 / BG. BINA MARINE 90"
   ]
  },
  {
   "pairCode": "TBG-042",
   "tb": "TB. BINTANG POWER 09",
   "bg": "BG. FINACIA 60",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BINTANG POWER 09 / BG. FINACIA 60"
   ]
  },
  {
   "pairCode": "TBG-043",
   "tb": "TB. BINTANG ANGKASA",
   "bg": "BG. MELLEDANG 108",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BINTANG ANGKASA / BG. MELLEDANG 108"
   ]
  },
  {
   "pairCode": "TBG-044",
   "tb": "TB. BINTANG POWER",
   "bg": "BG. BARAMAR 3010",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BINTANG POWER / BG. BARAMAR 3010"
   ]
  },
  {
   "pairCode": "TBG-045",
   "tb": "TB. BIWIN 10",
   "bg": "BG. BIL 05",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.BIWIN 10/BG.BIL 05"
   ]
  },
  {
   "pairCode": "TBG-046",
   "tb": "TB. HADI I",
   "bg": "BG. MARINI I",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. HADI I / BG. MARINI I",
    "KAPAL TB. HADI I / BG. MARINI I"
   ]
  },
  {
   "pairCode": "TBG-047",
   "tb": "TB. BMJ 8",
   "bg": "BG. BAHARI JAYA 9",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB BMJ 8/BG. BAHARI JAYA 9"
   ]
  },
  {
   "pairCode": "TBG-048",
   "tb": "TB. BMS 004",
   "bg": "BG. BMS 004A",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.BMS 004/BG.BMS 004A"
   ]
  },
  {
   "pairCode": "TBG-049",
   "tb": "TB. BMS 03",
   "bg": "BG. KSD 12",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BMS 03 / BG. KSD 12"
   ]
  },
  {
   "pairCode": "TBG-050",
   "tb": "TB. SB91",
   "bg": "BG. SAMUDRA BINTAN 2501",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.SB91/BG.SAMUDRA BINTAN 2501"
   ]
  },
  {
   "pairCode": "TBG-051",
   "tb": "TB. BRAHMA 11",
   "bg": "BG. ALRAI",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "BRAHMA 11 / BG. ALRAI",
    "TB. BRAHMA 11 / BG ALRAI"
   ]
  },
  {
   "pairCode": "TBG-052",
   "tb": null,
   "bg": "BG. TUNGGADEWI I",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; mungkin pasangan yang sama dengan TBG-053: ejaan TB mirip (TB. BRAWIDJAYA I)",
   "sapNames": [
    "BRAWIJAYA I / BG. TUNGGADEWI I"
   ]
  },
  {
   "pairCode": "TBG-053",
   "tb": null,
   "bg": "BG. TUNGGADEWI I",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; mungkin pasangan yang sama dengan TBG-052: ejaan TB mirip (TB. BRAWIJAYA I)",
   "sapNames": [
    "TB.BRAWIDJAYA I/BG.TUNGGADEWI I"
   ]
  },
  {
   "pairCode": "TBG-054",
   "tb": "TB. PANCARAN IV 915",
   "bg": "BG. BUANA 4501",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.PANCARAN IV 915 / BG. BUANA 4501"
   ]
  },
  {
   "pairCode": "TBG-055",
   "tb": "TB. CITRA 5B",
   "bg": "BG. CBS 2303",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "CITRA 5B / BG. CBS 2303"
   ]
  },
  {
   "pairCode": "TBG-056",
   "tb": "TB. CITRA MALINDO V",
   "bg": "BG. CBS 2306",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "CITRA MALINDO V / BG. CBS 2306"
   ]
  },
  {
   "pairCode": "TBG-057",
   "tb": "TB. CITRA 02",
   "bg": "BG. CITRA2502",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "CITRA 02 / TK. CITRA2502"
   ]
  },
  {
   "pairCode": "TBG-058",
   "tb": "TB. CITRA 03",
   "bg": "BG. CITRA 2503",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "CITRA 03 / BG. CITRA 2503"
   ]
  },
  {
   "pairCode": "TBG-059",
   "tb": "TB. CITRA 07",
   "bg": "BG. CITRA 45001",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. CITRA 07/BG. CITRA 45001"
   ]
  },
  {
   "pairCode": "TBG-060",
   "tb": "TB. CITRA 09",
   "bg": "BG. CITRA 3003",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "CITRA 09 / BG. CITRA 3003"
   ]
  },
  {
   "pairCode": "TBG-061",
   "tb": "TB. CITRA MAKMUR 235",
   "bg": "BG. OV-1",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. CITRA MAKMUR 235 / BG. OV - 01"
   ]
  },
  {
   "pairCode": "TBG-062",
   "tb": "TB. CITRA 60",
   "bg": "BG. CITRA 2501",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "CITRA 60 / BG. CITRA 2501"
   ]
  },
  {
   "pairCode": "TBG-063",
   "tb": "TB. CITRA 82",
   "bg": "BG. CITRA 3312",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "CITRA 82 / BG CITRA 3312"
   ]
  },
  {
   "pairCode": "TBG-064",
   "tb": "TB. CITRA MURNI",
   "bg": "BG. SAMUDERA IX",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.CITRA MURNI/BG.SAMUDERA IX"
   ]
  },
  {
   "pairCode": "TBG-065",
   "tb": "TB. DABO 7",
   "bg": "BG. MARINE POWER 2321",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "DABO 7 / BG. MARINE POWER 2321"
   ]
  },
  {
   "pairCode": "TBG-066",
   "tb": "TB. DB 3",
   "bg": "BG. WKA 4",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "DB 3 / TK. WKA 4"
   ]
  },
  {
   "pairCode": "TBG-067",
   "tb": "TB. ENDEAVOR 2",
   "bg": "BG. PACIFIC HARMONY",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. ENDEAVOR 2/BG. PACIFIC HARMONY"
   ]
  },
  {
   "pairCode": "TBG-068",
   "tb": "TB. HIKMAH 02",
   "bg": "BG. FORTUNA ANDRE 001",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.HIKMAH 02/BG.FORTUNA ANDRE 001"
   ]
  },
  {
   "pairCode": "TBG-069",
   "tb": "TB. KALTIM DOLPHIN",
   "bg": "BG. KALTIM FT3601",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.KALTIM DOLPHIN/BG.KALTIM FT3601"
   ]
  },
  {
   "pairCode": "TBG-070",
   "tb": "TB. AS JAYA 6",
   "bg": "BG. AS GLORY 16",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. AS JAYA 6 / BG. AS GLORY 16"
   ]
  },
  {
   "pairCode": "TBG-071",
   "tb": "TB. GLOBAL MARINE 02",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.GLOBAL MARINE 02/BG. GLOBAL MARI"
   ]
  },
  {
   "pairCode": "TBG-072",
   "tb": "TB. GLORY 99",
   "bg": "BG. SAHABAT KAPUAS B1",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. GLORY 99/BG.SAHABAT KAPUAS B1"
   ]
  },
  {
   "pairCode": "TBG-073",
   "tb": "TB. HADI 1",
   "bg": "BG. MARINI 1",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. HADI 1 / BG. MARINI 1"
   ]
  },
  {
   "pairCode": "TBG-074",
   "tb": "TB. HIKMAH -1",
   "bg": "BG. WELLY 1",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "HIKMAH -1 / BG. WELLY 1"
   ]
  },
  {
   "pairCode": "TBG-075",
   "tb": "TB. JEAN",
   "bg": "BG. DEWI MURNI",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. JEAN / BG. DEWI MURNI"
   ]
  },
  {
   "pairCode": "TBG-076",
   "tb": "TB. EVER ALPHA",
   "bg": "BG. EVER JUPI",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. EVER ALPHA / BG. EVER JUPI"
   ]
  },
  {
   "pairCode": "TBG-077",
   "tb": null,
   "bg": "BG. SAHABAT KAPUAS IV",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TK. SAHABAT KAPUAS IV/TB. MITRA JAY"
   ]
  },
  {
   "pairCode": "TBG-078",
   "tb": "TB. GOLDEN HAND",
   "bg": "BG. KAPUAS 118",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. GOLDEN HAND / BG. KAPUAS 118"
   ]
  },
  {
   "pairCode": "TBG-079",
   "tb": "TB. KARYODHI 2",
   "bg": "BG. KPS 1310",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.KARYODHI 2/BG.KPS 1310"
   ]
  },
  {
   "pairCode": "TBG-080",
   "tb": "TB. KSD 27",
   "bg": "BG. KSD 28",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "KSD 27 / BG. KSD 28"
   ]
  },
  {
   "pairCode": "TBG-081",
   "tb": "TB. MAXIMUS 777",
   "bg": "BG. LUMINOR 6",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan",
   "sapNames": [
    "TB MAXIMUS 777 / BG. LUMINOR 6 V.23"
   ]
  },
  {
   "pairCode": "TBG-082",
   "tb": "TB. HERMES 1",
   "bg": "BG. LUMINOR 3",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.HERMES 1/BG.LUMINOR 3"
   ]
  },
  {
   "pairCode": "TBG-083",
   "tb": "TB. MEGA 09",
   "bg": "BG. MAKMUR ABADI XVII",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. MEGA 09 /BG. MAKMUR ABADI XVII"
   ]
  },
  {
   "pairCode": "TBG-084",
   "tb": "TB. MACALLAN 6",
   "bg": "BG. LAFITE",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB MACALLAN 6 / BG LAFITE"
   ]
  },
  {
   "pairCode": "TBG-085",
   "tb": "TB. MARINA 1221",
   "bg": "BG. MARINE POWER 2319",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "MARINA 1221 / BG. MARINE POWER 2319"
   ]
  },
  {
   "pairCode": "TBG-086",
   "tb": "TB. AS MARINA 1",
   "bg": "BG. MARINA 2",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. AS MARINA 1/BG. MARINA 2"
   ]
  },
  {
   "pairCode": "TBG-087",
   "tb": "TB. HADI II",
   "bg": "BG. MARINI II",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. HADI II/BG. MARINI II"
   ]
  },
  {
   "pairCode": "TBG-088",
   "tb": null,
   "bg": "BG. CIPTA JAYA X",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; mungkin pasangan yang sama dengan TBG-089: ejaan TB mirip (TB. MAS LINES 1003)",
   "sapNames": [
    "MAS LINES 1001 / BG. CIPTA JAYA X"
   ]
  },
  {
   "pairCode": "TBG-089",
   "tb": null,
   "bg": "BG. CIPTA JAYA X",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; mungkin pasangan yang sama dengan TBG-088: ejaan TB mirip (TB. MAS LINES 1001)",
   "sapNames": [
    "MAS LINES 1003 / BG. CIPTA JAYA X"
   ]
  },
  {
   "pairCode": "TBG-090",
   "tb": "TB. MASLINES 1003",
   "bg": "BG. JEEMS TRANSPORT",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan",
   "sapNames": [
    "MASLINES 1003 / BG. JEEMS TRANSPORT"
   ]
  },
  {
   "pairCode": "TBG-091",
   "tb": "TB. MAXIMUS 809",
   "bg": "BG. AS GLORY 6",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan",
   "sapNames": [
    "MAXIMUS 809 / BG. AS GLORY 6"
   ]
  },
  {
   "pairCode": "TBG-092",
   "tb": "TB. OSEANIK 02",
   "bg": "BG. MEL 01",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. OSEANIK 02 / BG. MEL 01"
   ]
  },
  {
   "pairCode": "TBG-093",
   "tb": "TB. MELATI BARU 4",
   "bg": "BG. ROBBY 44",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "MELATI BARU 4 / BG. ROBBY 44"
   ]
  },
  {
   "pairCode": "TBG-094",
   "tb": "TB. MILLENIUM",
   "bg": "BG. PUTRA MUSI",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. MILLENIUM/BG. PUTRA MUSI"
   ]
  },
  {
   "pairCode": "TBG-095",
   "tb": "TB. MITRA KENCANA 5",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.MITRA KENCANA 5/TK. MITRA BAHARI"
   ]
  },
  {
   "pairCode": "TBG-096",
   "tb": "TB. MITRA JAYA II",
   "bg": "BG. SBU 88",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. MITRA JAYA II/TK.SBU 88"
   ]
  },
  {
   "pairCode": "TBG-097",
   "tb": "TB. MITRA 227",
   "bg": "BG. SEJAHTERA D12",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.MITRA 227/BG.SEJAHTERA D12"
   ]
  },
  {
   "pairCode": "TBG-098",
   "tb": "TB. MITRA JAYA III",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. MITRA JAYA III/TK. SAHABAT KAPU"
   ]
  },
  {
   "pairCode": "TBG-099",
   "tb": "TB. MITRA JAYA IX",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. MITRA JAYA IX/BG. SAHABAT KAPUA"
   ]
  },
  {
   "pairCode": "TBG-100",
   "tb": "TB. MITRA JAYA XVIII",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.MITRA JAYA XVIII/BG.MAKMUR ABADI"
   ]
  },
  {
   "pairCode": "TBG-101",
   "tb": "TB. MODALWAN 1063",
   "bg": "BG. ASIAPRIDE 2350",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "MODALWAN 1063 / BG. ASIAPRIDE 2350",
    "TB.MODALWAN 1063/BG. ASIAPRIDE 2350"
   ]
  },
  {
   "pairCode": "TBG-102",
   "tb": "TB. MODALWAN NO 8",
   "bg": "BG. TC 2301",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.MODALWAN NO 8/BG. TC 2301"
   ]
  },
  {
   "pairCode": "TBG-103",
   "tb": "TB. NUR HIDAYAH 1101",
   "bg": "BG. NUR HIDAYAH",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "NUR HIDAYAH 1101 / BG. NUR HIDAYAH"
   ]
  },
  {
   "pairCode": "TBG-104",
   "tb": "TB. ONI XII",
   "bg": "BG. ILIR JAYA",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. ONI XII/BG ILIR JAYA",
    "TB. ONI XII / BG. ILIR JAYA"
   ]
  },
  {
   "pairCode": "TBG-106",
   "tb": "TB. OZONE 88",
   "bg": "BG. MAS LINES 101",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan",
   "sapNames": [
    "OZONE 88 / BG. MAS LINES 101",
    "TB. OZONE 88/BG. MAS LINES 101"
   ]
  },
  {
   "pairCode": "TBG-107",
   "tb": "TB. KARYA PACIFIC 2282",
   "bg": "BG. PACIFIC",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.KARYA PACIFIC 2282/BG. PACIFIC"
   ]
  },
  {
   "pairCode": "TBG-108",
   "tb": "TB. TRANS PACIFIC 66",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.TRANS PACIFIC 66/BG.INDO OCEAN M"
   ]
  },
  {
   "pairCode": "TBG-109",
   "tb": "TB. TIRTA BAHARI 03",
   "bg": "BG. PRIMA 91",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TK. PRIMA 91/TB. TIRTA BAHARI 03"
   ]
  },
  {
   "pairCode": "TBG-110",
   "tb": "TB. PRIMA SAKTI VI",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR"
   ]
  },
  {
   "pairCode": "TBG-111",
   "tb": "TB. PRIMA SAKTI VIII",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. PRIMA SAKTI VIII/BG PRIMA SAMUD"
   ]
  },
  {
   "pairCode": "TBG-112",
   "tb": "TB. PRIMA SAKTI IX",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. PRIMA SAKTI IX / BG. PRIMA SAMU"
   ]
  },
  {
   "pairCode": "TBG-113",
   "tb": "TB. SBA 01",
   "bg": "BG. SIAK BAHAGIA",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "SBA 01 / BG. SIAK BAHAGIA"
   ]
  },
  {
   "pairCode": "TBG-114",
   "tb": "TB. SDS 44",
   "bg": "BG. CITEURUP 2",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "SDS 44 / BG. CITEURUP 2"
   ]
  },
  {
   "pairCode": "TBG-115",
   "tb": "TB. SEA DOLPHIN",
   "bg": "BG. APOLLO SUPER II",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "SEA DOLPHIN / BG. APOLLO SUPER II"
   ]
  },
  {
   "pairCode": "TBG-116",
   "tb": "TB. SEBESI",
   "bg": "BG. SEBUKU",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "SEBESI / BG SEBUKU"
   ]
  },
  {
   "pairCode": "TBG-117",
   "tb": "TB. PRATAMA V",
   "bg": "BG. SEJAHTERA MAKMUR V",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.PRATAMA V/BG.SEJAHTERA MAKMUR V"
   ]
  },
  {
   "pairCode": "TBG-118",
   "tb": "TB. ANUGRAH 17",
   "bg": "BG. SENTOSA JAYA 2307",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.ANUGRAH 17/BG.SENTOSA JAYA 2307"
   ]
  },
  {
   "pairCode": "TBG-119",
   "tb": "TB. PACIFIC STAR I",
   "bg": "BG. SHERIN 03",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TK. SHERIN 03/TB. PACIFIC STAR I"
   ]
  },
  {
   "pairCode": "TBG-120",
   "tb": "TB. SAMUDRA SINDO 26",
   "bg": "BG. ARIEL T XI",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.SAMUDRA SINDO 26/BG.ARIEL T XI"
   ]
  },
  {
   "pairCode": "TBG-121",
   "tb": null,
   "bg": "BG. SAHABAT KAPUAS MANDIRI XXIX",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TK. SAHABAT KAPUAS MANDIRI XXIX/TB."
   ]
  },
  {
   "pairCode": "TBG-122",
   "tb": "TB. SAHABAT KAPUAS UTAMA III",
   "bg": "BG. LA",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. SAHABAT KAPUAS UTAMA III/TK. LA"
   ]
  },
  {
   "pairCode": "TBG-123",
   "tb": "TB. SINGSING 18",
   "bg": "BG. SMB 9",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TK. SMB 9/TB. SINGSING 18"
   ]
  },
  {
   "pairCode": "TBG-124",
   "tb": "TB. SMT 1601",
   "bg": "BG. MARITIME LADY",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. SMT 1601 / BG. MARITIME LADY"
   ]
  },
  {
   "pairCode": "TBG-125",
   "tb": "TB. STK PRIMA 5",
   "bg": "BG. STK MERLION 111",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. STK PRIMA 5/BG.STK MERLION 111",
    "TB.STK PRIMA 5 / BG.STK MERLION 111"
   ]
  },
  {
   "pairCode": "TBG-126",
   "tb": "TB. AREK SUROBOYO 02",
   "bg": "BG. BOSS 02",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.AREK SUROBOYO 02/BG.BOSS 02"
   ]
  },
  {
   "pairCode": "TBG-127",
   "tb": "TB. TANIMAS",
   "bg": "BG. TANIMAS MARINE",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. TANIMAS/BG. TANIMAS MARINE"
   ]
  },
  {
   "pairCode": "TBG-128",
   "tb": "TB. BSI III",
   "bg": "BG. BSI II",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.BSI III/BG.BSI II"
   ]
  },
  {
   "pairCode": "TBG-129",
   "tb": "TB. TN 115",
   "bg": "BG. OB TN 115",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. TN 115/BG. OB TN 115"
   ]
  },
  {
   "pairCode": "TBG-130",
   "tb": "TB. TELUK BAJAU DELTA",
   "bg": "BG. SMS 3002",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. TELUK BAJAU DELTA/BG. SMS 3002"
   ]
  },
  {
   "pairCode": "TBG-131",
   "tb": "TB. TOB 21",
   "bg": "BG. AS GLORY 6",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; BG ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan",
   "sapNames": [
    "TOB 21 / BG. AS GLORY 6"
   ]
  },
  {
   "pairCode": "TBG-132",
   "tb": "TB. TOB 23",
   "bg": "BG. MANNALINE 9003",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TOB 23 / BG. MANNALINE 9003"
   ]
  },
  {
   "pairCode": "TBG-133",
   "tb": "TB. TOB 26",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; TB ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; mungkin pasangan yang sama dengan TBG-134: nama BG saling memotong (BG. SWISS BORNEO 271106)",
   "sapNames": [
    "TB. TOB 26 / BG. SWISS BORNEO 27110"
   ]
  },
  {
   "pairCode": "TBG-134",
   "tb": "TB. TOB 26",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui; TB ini punya beberapa pasangan dan tidak ada yang bertanggal; belum bisa ditentukan; mungkin pasangan yang sama dengan TBG-133: nama BG saling memotong (BG. SWISS BORNEO 27110)",
   "sapNames": [
    "TOB 26 / BG. SWISS BORNEO 271106"
   ]
  },
  {
   "pairCode": "TBG-135",
   "tb": "TB. TRANSPOWER 166",
   "bg": "BG. GOLDTRANS 3008",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TRANSPOWER 166 / BG. GOLDTRANS 3008"
   ]
  },
  {
   "pairCode": "TBG-136",
   "tb": "TB. TRANS POWER 219",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TRANS POWER 219 / BG. GOLD TRANS 30"
   ]
  },
  {
   "pairCode": "TBG-137",
   "tb": "TB. TRANSPOWER 245",
   "bg": "BG. GOLDTRANS 3002",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TRANSPOWER 245 / BG. GOLDTRANS 3002"
   ]
  },
  {
   "pairCode": "TBG-138",
   "tb": "TB. TRANS PACIFIC 99",
   "bg": null,
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. TRANS PACIFIC 99/TK. INDO OCEAN"
   ]
  },
  {
   "pairCode": "TBG-139",
   "tb": "TB. TRANS POWER 212",
   "bg": "BG. GOLD TRANS",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB. TRANS POWER 212/BG. GOLD TRANS"
   ]
  },
  {
   "pairCode": "TBG-140",
   "tb": "TB. TRIN POWER",
   "bg": "BG. LABROY 195",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TRIN POWER / TK LABROY 195"
   ]
  },
  {
   "pairCode": "TBG-141",
   "tb": "TB. OCEAN VENTURE III",
   "bg": "BG. SAMUDRA XI",
   "firstContractDate": null,
   "lastContractDate": null,
   "sapRows2026": null,
   "note": "tidak muncul di ekspor SAP 01 Jan - 02 Okt 2026; tanggal tidak diketahui",
   "sapNames": [
    "TB.OCEAN VENTURE III/BG.SAMUDRA XI"
   ]
  }
 ]
};

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const pushDhm = argv.includes('--push-dhm');
const renameExisting = argv.includes('--rename-existing');

function show(title, rows, fmt, limit = 60) {
  if (rows.length === 0) return;
  console.log(`\n${title} (${rows.length})`);
  rows.slice(0, limit).forEach((r) => console.log('  ' + fmt(r)));
  if (rows.length > limit) console.log(`  ... ${rows.length - limit} more`);
}

(async () => {
  const pool = dist('database/connection').default;
  const svc = dist('services/vesselMasterLoad.service');

  const schema = await pool.query(
    `SELECT to_regclass('public.vessel_pairs') AS pairs,
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'master_vessels' AND column_name = 'vessel_role') AS role`,
  );
  if (!schema.rows[0].pairs || !schema.rows[0].role) {
    console.error('Migration 230 is not applied (vessel_role / vessel_pairs missing). Deploy the backend first.');
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();
  let exitCode = 0;
  try {
    const plans = await svc.planVesselLoad(client, DATA);
    const by = (a) => plans.filter((p) => p.decision.action === a);
    console.log(`File: ${DATA.vessels.length} vessels (${DATA.vessels.filter((v) => v.role === 'TB').length} TB, ${DATA.vessels.filter((v) => v.role === 'BG').length} BG), ${DATA.pairs.length} pairs`);
    console.log(`Plan: ${by('create').length} to create, ${by('exists').length} already in the master (reused, empty fields filled), ${by('duplicate').length} duplicate spellings in the file (same vessel), ${by('conflict').length} conflicts (skipped)`);

    if (by('create').length <= 40) show('TO CREATE', by('create'), (p) => `${p.vessel.role} ${p.vessel.name}${p.decision.codes.length ? '  [' + p.decision.codes.join(', ') + ']' : ''}`);
    show('CONFLICTS - skipped, decide by hand', by('conflict'), (p) => `${p.vessel.role} ${p.vessel.name}: ${p.decision.reasons.join('; ')}`);
    const skipped = plans.flatMap((p) => p.decision.skippedCodes.map((s) => ({ p, ...s })));
    const twinned = plans.filter((p) => p.decision.twins && p.decision.twins.length > 0);
    show('POSSIBLE TWINS in the master (same vessel, other spelling - merge with merge-master-vessel.cjs)', twinned, (p) =>
      `${p.vessel.role} ${p.vessel.name} [${p.decision.existing.vessel_code}]  ~  ${p.decision.twins.map((t) => `"${t.vessel_name}" [${t.vessel_code}]`).join(', ')}`);
    show('DUPLICATE spellings in the file (loaded once)', by('duplicate'), (p) => `${p.vessel.role} ${p.vessel.name} = ${p.decision.duplicateOf}`);
    const renames = svc.plannedRenames(plans);
    show(renameExisting ? 'NAMES that will be changed to the clean name' : 'NAMES that --rename-existing would change to the clean name', renames, (r) => `${r.from}  ->  ${r.to}`, 30);
    show('SAP CODES left where they are (another vessel already holds them)', skipped, (s) => `${s.code} -> held by "${s.heldBy}", not given to ${s.p.vessel.name}`);
    show('Already in the master', by('exists'), (p) => `${p.vessel.role} ${p.vessel.name} = ${p.decision.existing.vessel_name} [${p.decision.existing.vessel_code}, ${p.decision.existing.code_status}${p.decision.existing.vessel_role ? ', ' + p.decision.existing.vessel_role : ''}]`, 25);
    console.log(`\nWith a SAP code: ${plans.filter((p) => p.decision.codes.length > 0).length} vessels; provisional (no code): ${plans.filter((p) => p.decision.codes.length === 0 && p.decision.action === 'create').length}`);

    let ids = new Map();
    if (!apply && !pushDhm) {
      console.log('\nDry run - nothing written. Add --apply to load, then --push-dhm to push to DHM.');
      return;
    }

    if (apply) {
      await client.query('BEGIN');
      let result;
      try {
        result = await svc.applyVesselLoad(client, DATA, plans, { renameExisting });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      ids = result.ids;
      console.log(`\nLOADED: ${result.created} created, ${result.reused} reused${renameExisting ? ` (${result.renamed} renamed)` : ''}, ${result.duplicates} duplicate spellings, ${result.conflicts} conflicts skipped, ${result.failed.length} failed.`);
      console.log(`Pairs: ${result.pairsCreated} created, ${result.pairsUpdated} updated, ${result.pairsSkipped.length} skipped.`);
      show('FAILED vessels', result.failed, (f) => `${f.name}: ${f.error}`);
      show('Pairs skipped', result.pairsSkipped, (s) => `${s.pairCode}: ${s.reason}`);
    } else {
      // push only: the vessels of this file that are already in the master with the right role
      for (const p of plans) if (p.decision.action === 'exists') ids.set(`${p.vessel.role}|${p.vessel.name}`, p.decision.existing.id);
    }

    if (pushDhm) {
      // The server loads the DHM settings saved in the Integrations menu (database) at boot and they win over .env. This is a separate
      // process, so without this it talks to DHM with the raw .env values - which can be stale or different - and every call fails.
      await dist('integrations/settingsStore').loadIntegrationSettings();
      const catalog = dist('dhm/catalog');
      try {
        await catalog.fetchDhmCatalog(true);
      } catch (e) {
        console.error(`
DHM is not reachable with the saved settings (${e && e.message ? e.message : e}). Nothing was pushed - check the DHM settings in the Integrations menu.`);
        process.exitCode = 1; // the finally below still releases the client and closes the pool
        return;
      }
      const enumValues = await catalog.getDhmVesselTypeEnumValues();
      const tugValue = (enumValues || []).find((v) => /tug/i.test(String(v)));
      console.log(`\nDHM Vessel_Type values on the Hub: ${enumValues ? enumValues.join(', ') : '(catalog not readable)'}`);
      console.log(tugValue ? `  tugs are sent as "${tugValue}"` : '  the Hub has NO tug value: tugs are pushed WITHOUT a type (ask the DHM Integrator to add one)');
      console.log(`Pushing ${new Set(ids.values()).size} vessels to DHM ...`);
      const out = await svc.pushLoadedVesselsToDhm(ids.values(), { delayMs: 150 });
      if (out.dhmDisabled) console.log('DHM is not enabled in this environment (DHM_ENABLED): nothing was pushed.');
      else {
        console.log(`DHM: ${out.attempted} attempted, ${out.ok} ok, ${out.conflicts.length} name already in DHM (linked), ${out.errors.length} errors.`);
        show('DHM conflicts (the Hub already holds that name)', out.conflicts, (c) => `${c.name} -> ${c.dhmCode || '?'}`);
        show('DHM errors', out.errors, (e) => `${e.name}: ${e.error}`);
      }
    }
  } catch (error) {
    console.error('\nFailed:', error && error.message ? error.message : error);
    exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
  if (exitCode) process.exit(exitCode);
})();
