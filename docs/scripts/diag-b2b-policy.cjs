/*
 * READ-ONLY: which side of a B2B family should outstanding come from?
 *
 *   node /app/diag-b2b-policy.cjs                       (whole database, YTD)
 *   node /app/diag-b2b-policy.cjs CPO BONTANG
 *   node /app/diag-b2b-policy.cjs CPO BONTANG 2026-01-01 2026-09-22
 *
 * WHY. B2B doubling is how outstanding ballooned on these pages before, so each page picks ONE
 * side of a family. Which side is right is a question about the SAP data, not about taste, and the
 * answer moved once already: the STO link migrated to the child over time. This classifies every
 * pair by who holds the VALUE and who holds the LINK, so the policy can be chosen from the data.
 *
 * MEASURED on the dev copy, 2026-09-22, over all 566 pairs:
 *   - parents holding an sto/shipment link of their own : 0
 *   - parents with no contract_qty_move_snapshot row    : 0
 * Both absolutes. The value always sits on the parent, the movement always on the child, so the
 * only policy that covers the data is: keep the CHILD's row as the carrier, value and attribute it
 * under the PARENT. Contract Performance and Shipments already do this. Shipping Performance wrote
 * the relabel and then discarded it at the STO merge.
 *
 * Case C is the trap. There the parent is fully delivered (4,500 out, 4,500 received) and the
 * child is an empty duplicate (0 / 0) still showing its whole quantity. A "fall back to the child
 * when the parent has no outstanding" rule inflates outstanding by 17,402 MT across 49 pairs.
 * Zero is not null.
 */
const D='/app/dist',p=require('path'),fs=require('fs');
const R=(m)=>require(p.join(fs.existsSync(D)?D:p.join(__dirname,'backend','dist'),m));
const conn=R('database/connection');
const {sqlContractExecutionOutstandingKgExpr}=R('utils/contractExecutionOutstandingSql');
const {resolveContractsQtyMoveCte}=R('services/contractQtyMoveSnapshot.service');
const {sqlRegionSiteDisplayForContract}=R('utils/regionSiteSql');
const PRODUCT=(process.argv[2]||'').trim().toUpperCase(),SITE=(process.argv[3]||'').trim().toUpperCase();
const FROM=(process.argv[4]||new Date().getFullYear()+'-01-01').trim(),TO=(process.argv[5]||new Date().toISOString().slice(0,10)).trim();
const mt=(k)=>(Number(k||0)/1000).toLocaleString('en-US',{maximumFractionDigits:1});
const FAM=`SELECT o2.contract_id FROM contracts o2 JOIN contract_latest_spd_snapshot l2
   ON NULLIF(TRIM(o2.po_number::text),'')=NULLIF(TRIM(l2.contract_reference_po_raw),'')
   WHERE UPPER(TRIM(COALESCE(l2.b2b_flag_raw,'')))='B2B'
 UNION SELECT l3.contract_number FROM contract_latest_spd_snapshot l3
   WHERE UPPER(TRIM(COALESCE(l3.b2b_flag_raw,'')))='B2B'
     AND NULLIF(TRIM(l3.contract_reference_po_raw),'') IS NOT NULL`;
const LINKS=(alias)=>`(
  (SELECT COUNT(*)::int FROM contract_stos cs JOIN contracts x ON x.id=cs.contract_id WHERE x.contract_id=${alias})
  + (SELECT COUNT(*)::int FROM contracts x2 WHERE x2.contract_id=${alias} AND NULLIF(TRIM(x2.sto_number::text),'') IS NOT NULL)
  + (SELECT COUNT(*)::int FROM shipments s JOIN contracts x3 ON x3.id=s.contract_id WHERE x3.contract_id=${alias}))`;
(async()=>{
  const cte=await resolveContractsQtyMoveCte({kind:'in_subquery',subquery:FAM});
  const rs=sqlRegionSiteDisplayForContract('oc.contract_id','oc.po_number');
  const par=[FROM,TO],sc=['AND oc.contract_date >= $1 AND oc.contract_date <= $2'];
  if(PRODUCT){par.push(PRODUCT);sc.push(`AND UPPER(TRIM(COALESCE(oc.product,''))) LIKE '%'||$${par.length}||'%'`);}
  if(SITE){par.push(SITE);sc.push(`AND UPPER(TRIM(COALESCE((${rs}),'')))=$${par.length}`);}
  const sql=`WITH ${cte}, pairs AS (
      SELECT l.contract_number AS child,o.contract_id AS origin
      FROM contract_latest_spd_snapshot l
      JOIN contracts o ON NULLIF(TRIM(o.po_number::text),'')=NULLIF(TRIM(l.contract_reference_po_raw),'')
      WHERE UPPER(TRIM(COALESCE(l.b2b_flag_raw,'')))='B2B'
        AND NULLIF(TRIM(l.contract_reference_po_raw),'') IS NOT NULL)
    SELECT p.child,p.origin,oc.product,(${rs}) AS region_site,
      ${LINKS('p.origin')} AS parent_links, ${LINKS('p.child')} AS child_links,
      (${sqlContractExecutionOutstandingKgExpr('p.origin')})::numeric AS parent_os,
      (${sqlContractExecutionOutstandingKgExpr('p.child')})::numeric AS child_os
    FROM pairs p JOIN contracts oc ON oc.contract_id=p.origin WHERE 1=1 ${sc.join(' ')}`;
  const rows=(await conn.query(sql,par)).rows,n=(v)=>Number(v)||0;
  const B={A:[],B:[],C:[],D:[],E:[]};
  for(const r of rows){
    const po=n(r.parent_os),co=n(r.child_os),pl=n(r.parent_links),cl=n(r.child_links);
    if(po>0&&co>0) B.D.push(r);
    else if(po>0&&pl>0) B.A.push(r);
    else if(po>0&&pl===0&&cl>0) B.B.push(r);
    else if(po<=0&&co>0) B.C.push(r);
    else B.E.push(r);
  }
  const sum=(a,f)=>a.reduce((x,r)=>x+n(r[f]),0);
  console.log(`scope: ${PRODUCT||'all products'} / ${SITE||'all sites'} / ${FROM}..${TO}`);
  console.log(`B2B child -> origin pairs: ${rows.length}\n`);
  console.log(`A  parent has OS and its OWN sto/shipment link : ${String(B.A.length).padStart(4)}   ${mt(sum(B.A,'parent_os'))} MT`);
  console.log(`B  parent has OS, NO link - only the child has : ${String(B.B.length).padStart(4)}   ${mt(sum(B.B,'parent_os'))} MT`);
  console.log(`C  parent has NO OS, the child carries it      : ${String(B.C.length).padStart(4)}   ${mt(sum(B.C,'child_os'))} MT`);
  console.log(`D  BOTH carry OS - the same qty recorded twice : ${String(B.D.length).padStart(4)}   ${mt(B.D.reduce((a,r)=>a+Math.min(n(r.parent_os),n(r.child_os)),0))} MT overlap`);
  console.log(`E  neither carries OS                          : ${String(B.E.length).padStart(4)}`);
  console.log('');
  console.log('READING IT');
  console.log('  A   every policy works.');
  console.log('  B   a page built from shipments can only reach the parent THROUGH the child.');
  console.log('      Contract Performance is fine (contract grain); Shipments, which drops the');
  console.log('      child and never sees the parent, shows nothing.');
  console.log('  C   parent-only policy LOSES this. Contract Performance drops B2B children, so');
  console.log('      this tonnage is invisible there too.');
  console.log('  D   one side must be chosen or the quantity doubles.');
  process.exit(0);
})().catch(e=>{console.error('ERR',String(e&&e.message?e.message:e).slice(0,300));process.exit(1);});
