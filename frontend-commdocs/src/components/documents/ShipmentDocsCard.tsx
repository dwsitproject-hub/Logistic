"use client";

import { useEffect, useState } from "react";
import { apiData, errorMessage } from "@/lib/api";
import { dateTime, longDate, plural } from "@/lib/format";
import { fileSize } from "@/lib/files";
import type { ShipmentDocGroup } from "@/lib/types";

export type ShipmentDoc = ShipmentDocGroup["documents"][number];
type DocType = ShipmentDoc["type"];

/**
 * The kinds of file a voyage carries, in the order of the chips. BL and SI make the Shipment Docs slot (a PO is "uploaded" with either); Loading, Discharge and Others
 * are internal documents KLIP added to Edit Shipment: shown beside them as information, never counted towards the slot or the completeness (Ryan, 2026-11-27).
 */
export const SHIPMENT_DOC_KINDS: Array<{
  type: DocType;
  label: string;
  slot: boolean;
}> = [
  { type: "BL", label: "BL", slot: true },
  { type: "SI", label: "SI", slot: true },
  { type: "SLD", label: "Loading", slot: false },
  { type: "SDD", label: "Discharge", slot: false },
  { type: "OTHER", label: "Others", slot: false },
];
/** The note behind the (i) beside the Shipment Docs title in the viewer bar. */
export const SHIPMENT_DOCS_NOTE =
  "These files are uploaded in KLIP (Shipments > Edit Shipment). Here they are view only. The slot counts a BL or SI; Loading, Discharge and Others are for information.";
const isSlot = (d: ShipmentDoc) => d.type === "BL" || d.type === "SI";

/**
 * The files uploaded in KLIP (Shipments > Edit Shipment) for this PO, grouped by voyage. Loaded by the drawer, which lists "Shipment Docs" in the checklist like any
 * other document type and shows the picked file in the same viewer. `files` is everything the picker offers; `slotFiles` (BL / SI) is what counts for the slot,
 * the row's file count and the latest upload. The Contract of a shipment is not here: COD has its own Contract type.
 */
export function useShipmentDocs(poKey: string) {
  const [groups, setGroups] = useState<ShipmentDocGroup[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!poKey) return;
    const ctrl = new AbortController();
    setGroups(null);
    setError("");
    apiData<{ groups: ShipmentDocGroup[] }>(
      `/commercial-documents/shipment-docs/${encodeURIComponent(poKey)}`,
      { signal: ctrl.signal },
    )
      .then((d) => setGroups(d?.groups || []))
      .catch((err) => {
        if (!ctrl.signal.aborted)
          setError(errorMessage(err, "Could not load the shipment documents."));
      });
    return () => ctrl.abort();
  }, [poKey]);

  const files = groups ? groups.flatMap((g) => g.documents) : [];
  const slotFiles = files.filter(isSlot);
  const latest = slotFiles.reduce<ShipmentDoc | null>(
    (best, d) =>
      !best || String(d.uploadedAt).localeCompare(String(best.uploadedAt)) > 0
        ? d
        : best,
    null,
  );
  return { groups, files, slotFiles, latest, error };
}

const voyageLabel = (g: ShipmentDocGroup) =>
  [
    g.vesselName || "Vessel not set",
    g.voyageNo ? `V${g.voyageNo}` : "",
    g.date ? longDate(g.date) : "",
  ]
    .filter(Boolean)
    .join(" · ");
const voyageTip = (g: ShipmentDocGroup) =>
  [
    g.reference ? `STO / operation ${g.reference}` : "",
    g.sharedWithPos.length
      ? `Shared with ${plural(g.sharedWithPos.length, "other PO")} (${g.sharedWithPos.join(", ")}): the files belong to the voyage`
      : "",
  ]
    .filter(Boolean)
    .join(". ");

/**
 * The file picker of the Shipment Docs type, in the drawer's right-hand panel above the viewer, kept to two lines so the viewer keeps its height: one row with the
 * voyage and a chip per kind of document (with its file count), then the files of the chosen kind, one line each. The chosen file's name is in the viewer bar.
 */
export function ShipmentDocsPicker({
  groups,
  selectedId,
  onSelect,
}: {
  groups: ShipmentDocGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!groups.length) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        Nothing has been uploaded in KLIP for this PO yet.
      </p>
    );
  }
  const group =
    groups.find((g) => g.documents.some((d) => d.id === selectedId)) ??
    groups[0];
  const current =
    group.documents.find((d) => d.id === selectedId) ?? group.documents[0];
  const tip = voyageTip(group);
  return (
    <div className="sd-pick" aria-label="Shipment Docs files">
      <div className="sd-bar">
        {groups.length > 1 ? (
          <select
            className="sd-voyage"
            aria-label="Voyage"
            value={group.shipmentId}
            title={tip}
            onChange={(e) =>
              onSelect(
                groups.find((g) => g.shipmentId === e.target.value)
                  ?.documents[0]?.id ?? "",
              )
            }
          >
            {groups.map((g) => (
              <option key={g.shipmentId} value={g.shipmentId}>
                {voyageLabel(g)}
              </option>
            ))}
          </select>
        ) : (
          <span className="sd-voyage one" title={tip}>
            {voyageLabel(group)}
          </span>
        )}
        <span className="sd-sep" aria-hidden />
        {SHIPMENT_DOC_KINDS.map(({ type, label, slot }) => {
          const docs = group.documents.filter((d) => d.type === type);
          const on = current?.type === type;
          return (
            <button
              type="button"
              key={type}
              className={`sd-chip${on ? " on" : ""}${slot ? "" : " extra"}`}
              aria-pressed={on}
              disabled={!docs.length}
              onClick={() => onSelect(docs[0].id)}
            >
              {label}
              <span className="n">{docs.length}</span>
            </button>
          );
        })}
      </div>
      {/* The chosen file's name is already in the viewer bar: its own row only appears when the kind holds several files to choose from. */}
      {group.documents.filter((d) => d.type === current?.type).length > 1
        ? group.documents
            .filter((d) => d.type === current?.type)
            .map((d) => (
              <button
                type="button"
                className="sd-row"
                key={d.id}
                aria-pressed={d.id === current?.id}
                title={d.uploadedBy ? `Uploaded by ${d.uploadedBy}` : undefined}
                onClick={() => onSelect(d.id)}
              >
                <span className="nm">{d.fileName}</span>
                <small>
                  {dateTime(d.uploadedAt)}
                  {d.sizeBytes ? ` · ${fileSize(d.sizeBytes)}` : ""}
                </small>
                <span className="badge">via KLIP</span>
              </button>
            ))
        : null}
    </div>
  );
}
