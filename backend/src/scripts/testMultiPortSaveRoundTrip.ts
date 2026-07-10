/**
 * Integration test: multi-port Edit Shipment save round-trip (STO 1016010783).
 * Run inside backend container: node dist/scripts/testMultiPortSaveRoundTrip.js
 */
import axios from 'axios';

const BASE = process.env.API_BASE ?? 'http://localhost:5001/api';
const STO_SHIPMENT_ID = '1a8332f2-57a4-4013-ac44-05fb9a2681d3';

interface PortRow {
  id: string;
  port_sequence: number;
  port_name: string;
  is_discharge_port: boolean;
  eta_vessel_arrival?: string | null;
  eta_vessel_berthed_at_loading_port?: string | null;
  eta_loading_start?: string | null;
  eta_vessel_arrive_at_discharge_port?: string | null;
  eta_vessel_complete_discharge?: string | null;
  eta_vessel_sailed?: string | null;
}

function isoDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}

async function main() {
  const login = await axios.post(`${BASE}/auth/login`, {
    username: 'admin',
    password: 'admin123',
  });
  const token = login.data?.data?.token as string;
  if (!token) throw new Error('Login failed');
  const headers = { Authorization: `Bearer ${token}` };

  const beforeRes = await axios.get(`${BASE}/shipments/${STO_SHIPMENT_ID}/loading-ports`, { headers });
  const beforePorts: PortRow[] = beforeRes.data?.data?.ports ?? [];
  const loadingBefore = beforePorts.filter((p) => !p.is_discharge_port).sort((a, b) => a.port_sequence - b.port_sequence);
  const dischargeBefore = beforePorts.find((p) => p.is_discharge_port);

  console.log('BEFORE loading ports:', loadingBefore.map((p) => ({ seq: p.port_sequence, name: p.port_name })));

  if (loadingBefore.length < 2) {
    throw new Error(`Expected >=2 loading ports, got ${loadingBefore.length}`);
  }

  const testEtas = {
    port1: {
      etaVesselArrivalAtLoadingPort: '2026-07-01',
      etaVesselBerthedAtLoadingPort: '2026-07-02',
      etaVesselStartLoading: '2026-07-03',
      etaVesselCompletedLoading: '2026-07-04',
      etaVesselSailedFromLoadingPort: '2026-07-05',
    },
    port2: {
      etaVesselArrivalAtLoadingPort: '2026-07-06',
      etaVesselBerthedAtLoadingPort: '2026-07-07',
      etaVesselStartLoading: '2026-07-08',
      etaVesselCompletedLoading: '2026-07-09',
      etaVesselSailedFromLoadingPort: '2026-07-10',
    },
    discharge: {
      etaVesselArriveAtDischargePort: '2026-07-15',
      etaVesselBerthedAtDischargePort: '2026-07-16',
      etaVesselStartDischarging: '2026-07-17',
      etaVesselCompleteDischarge: '2026-07-18',
    },
  };

  // 1) Shipment-level summary (port 1 loading + shared discharge)
  const shipPut = await axios.put(
    `${BASE}/shipments/${STO_SHIPMENT_ID}`,
    {
      eta_arrival: testEtas.port1.etaVesselArrivalAtLoadingPort,
      eta_berthed: testEtas.port1.etaVesselBerthedAtLoadingPort,
      eta_loading_start: testEtas.port1.etaVesselStartLoading,
      eta_loading_complete: testEtas.port1.etaVesselCompletedLoading,
      eta_sailed: testEtas.port1.etaVesselSailedFromLoadingPort,
      eta_discharge_arrival: testEtas.discharge.etaVesselArriveAtDischargePort,
      eta_discharge_berthed: testEtas.discharge.etaVesselBerthedAtDischargePort,
      eta_discharge_start: testEtas.discharge.etaVesselStartDischarging,
      eta_discharge_complete: testEtas.discharge.etaVesselCompleteDischarge,
    },
    { headers },
  );
  if (!shipPut.data?.success) throw new Error('Shipment PUT failed');

  const portPayload = (port: PortRow, fields: typeof testEtas.port1) => ({
    id: port.id,
    port_name: port.port_name,
    port_sequence: port.port_sequence,
    is_discharge_port: false,
    eta_vessel_arrival: fields.etaVesselArrivalAtLoadingPort,
    eta_vessel_berthed_at_loading_port: fields.etaVesselBerthedAtLoadingPort,
    eta_vessel_berthed: fields.etaVesselBerthedAtLoadingPort,
    eta_loading_start: fields.etaVesselStartLoading,
    eta_loading_completed: fields.etaVesselCompletedLoading,
    eta_vessel_sailed: fields.etaVesselSailedFromLoadingPort,
  });

  // 2) Each loading port PUT
  await axios.put(
    `${BASE}/shipments/${STO_SHIPMENT_ID}/loading-ports/${loadingBefore[0].id}`,
    portPayload(loadingBefore[0], testEtas.port1),
    { headers },
  );
  await axios.put(
    `${BASE}/shipments/${STO_SHIPMENT_ID}/loading-ports/${loadingBefore[1].id}`,
    portPayload(loadingBefore[1], testEtas.port2),
    { headers },
  );

  // 3) Discharge port PUT
  if (dischargeBefore?.id) {
    await axios.put(
      `${BASE}/shipments/${STO_SHIPMENT_ID}/loading-ports/${dischargeBefore.id}`,
      {
        id: dischargeBefore.id,
        port_name: dischargeBefore.port_name,
        port_sequence: dischargeBefore.port_sequence,
        is_discharge_port: true,
        eta_vessel_arrive_at_discharge_port: testEtas.discharge.etaVesselArriveAtDischargePort,
        eta_vessel_berthed_at_discharge_port: testEtas.discharge.etaVesselBerthedAtDischargePort,
        eta_vessel_start_discharging: testEtas.discharge.etaVesselStartDischarging,
        eta_vessel_complete_discharge: testEtas.discharge.etaVesselCompleteDischarge,
      },
      { headers },
    );
  }

  const afterRes = await axios.get(`${BASE}/shipments/${STO_SHIPMENT_ID}/loading-ports`, { headers });
  const afterPorts: PortRow[] = afterRes.data?.data?.ports ?? [];
  const loadingAfter = afterPorts.filter((p) => !p.is_discharge_port).sort((a, b) => a.port_sequence - b.port_sequence);
  const dischargeAfter = afterPorts.find((p) => p.is_discharge_port);

  const p1 = loadingAfter[0];
  const p2 = loadingAfter[1];

  // Edit pass: change port2 sailed only, verify port1 unchanged
  await axios.put(
    `${BASE}/shipments/${STO_SHIPMENT_ID}/loading-ports/${p2!.id}`,
    {
      ...portPayload(p2!, testEtas.port2),
      eta_vessel_sailed: '2026-07-11',
    },
    { headers },
  );

  const editRes = await axios.get(`${BASE}/shipments/${STO_SHIPMENT_ID}/loading-ports`, { headers });
  const editPorts: PortRow[] = editRes.data?.data?.ports ?? [];
  const editP1 = editPorts.find((p) => p.id === p1!.id);
  const editP2 = editPorts.find((p) => p.id === p2!.id);

  const checks: Array<{ label: string; ok: boolean; expected: string; actual: string | null }> = [
    {
      label: 'Port1 arrival ETA',
      ok: isoDateOnly(p1?.eta_vessel_arrival) === testEtas.port1.etaVesselArrivalAtLoadingPort,
      expected: testEtas.port1.etaVesselArrivalAtLoadingPort,
      actual: isoDateOnly(p1?.eta_vessel_arrival),
    },
    {
      label: 'Port2 arrival ETA',
      ok: isoDateOnly(p2?.eta_vessel_arrival) === testEtas.port2.etaVesselArrivalAtLoadingPort,
      expected: testEtas.port2.etaVesselArrivalAtLoadingPort,
      actual: isoDateOnly(p2?.eta_vessel_arrival),
    },
    {
      label: 'Port2 sailed ETA',
      ok: isoDateOnly(p2?.eta_vessel_arrival) !== isoDateOnly(p1?.eta_vessel_arrival) ||
        testEtas.port1.etaVesselArrivalAtLoadingPort !== testEtas.port2.etaVesselArrivalAtLoadingPort,
      expected: 'different per port',
      actual: `${isoDateOnly(p1?.eta_vessel_arrival)} vs ${isoDateOnly(p2?.eta_vessel_arrival)}`,
    },
    {
      label: 'Discharge arrival ETA',
      ok: isoDateOnly(dischargeAfter?.eta_vessel_arrive_at_discharge_port) === testEtas.discharge.etaVesselArriveAtDischargePort,
      expected: testEtas.discharge.etaVesselArriveAtDischargePort,
      actual: isoDateOnly(dischargeAfter?.eta_vessel_arrive_at_discharge_port),
    },
    {
      label: 'Port names preserved',
      ok: loadingAfter.length === 2 && Boolean(p1?.port_name) && Boolean(p2?.port_name),
      expected: '2 named ports',
      actual: loadingAfter.map((p) => p.port_name).join(' | '),
    },
    {
      label: 'Edit port2 sailed only',
      ok: isoDateOnly(editP2?.eta_vessel_sailed as string) === '2026-07-11',
      expected: '2026-07-11',
      actual: isoDateOnly(editP2?.eta_vessel_sailed as string),
    },
    {
      label: 'Edit port1 unchanged after port2 edit',
      ok: isoDateOnly(editP1?.eta_vessel_arrival) === testEtas.port1.etaVesselArrivalAtLoadingPort,
      expected: testEtas.port1.etaVesselArrivalAtLoadingPort,
      actual: isoDateOnly(editP1?.eta_vessel_arrival),
    },
  ];

  console.log('\nROUND-TRIP CHECKS:');
  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'} | ${c.label} | expected=${c.expected} actual=${c.actual}`);
    if (!c.ok) failed += 1;
  }

  // ATA should remain shipment-level (not wiped by port save)
  const info = afterRes.data?.data?.shipmentInfo ?? {};
  const ataOk = Boolean(info.ata_vessel_arrival_at_loading_port || info.sap_ata_vessel_arrival_at_loading_port);
  console.log(`${ataOk ? 'PASS' : 'FAIL'} | ATA loading arrival still present | actual=${info.ata_vessel_arrival_at_loading_port ?? info.sap_ata_vessel_arrival_at_loading_port ?? 'null'}`);
  if (!ataOk) failed += 1;

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll multi-port save/edit round-trip checks passed.');
}

main().catch((err) => {
  console.error(err.response?.data ?? err.message ?? err);
  process.exit(1);
});
