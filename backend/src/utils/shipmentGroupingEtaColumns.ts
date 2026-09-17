/** Excel ETA columns for Unplanned → Planning upload. Keys match createShipment etaByContract. */

export type GroupingEtaKey =
  | 'eta_arrival'
  | 'eta_berthed'
  | 'eta_loading_start'
  | 'eta_loading_complete'
  | 'eta_sailed'
  | 'eta_discharge_arrival'
  | 'eta_discharge_berthed'
  | 'eta_discharge_start'
  | 'eta_discharge_complete';

export const SHIPMENT_GROUPING_ETA_COLUMNS: ReadonlyArray<{
  header: string;
  key: GroupingEtaKey;
  aliases: string[];
}> = [
  { header: 'Arr. @ LP', key: 'eta_arrival', aliases: ['arr. @ lp', 'arr lp', 'eta arrival'] },
  { header: 'Berthed LP', key: 'eta_berthed', aliases: ['berthed lp'] },
  { header: 'Start Load', key: 'eta_loading_start', aliases: ['start load'] },
  { header: 'Done Load', key: 'eta_loading_complete', aliases: ['done load'] },
  { header: 'Sail LP', key: 'eta_sailed', aliases: ['sail lp'] },
  { header: 'Arr. @ DP', key: 'eta_discharge_arrival', aliases: ['arr. @ dp', 'arr dp'] },
  { header: 'Berthed DP', key: 'eta_discharge_berthed', aliases: ['berthed dp'] },
  { header: 'Start Disch', key: 'eta_discharge_start', aliases: ['start disch'] },
  { header: 'Done Disch', key: 'eta_discharge_complete', aliases: ['done disch'] },
];

export const SHIPMENT_GROUPING_ETA_KEYS: readonly GroupingEtaKey[] = SHIPMENT_GROUPING_ETA_COLUMNS.map(
  (col) => col.key,
);

export const SHIPMENT_GROUPING_ETA_HEADERS: readonly string[] = SHIPMENT_GROUPING_ETA_COLUMNS.map(
  (col) => col.header,
);

export function emptyGroupingEtas(): Record<GroupingEtaKey, string> {
  return {
    eta_arrival: '',
    eta_berthed: '',
    eta_loading_start: '',
    eta_loading_complete: '',
    eta_sailed: '',
    eta_discharge_arrival: '',
    eta_discharge_berthed: '',
    eta_discharge_start: '',
    eta_discharge_complete: '',
  };
}
