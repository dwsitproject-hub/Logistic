/**
 * Kill switch of registerVesselFromSap (services). On unless VESSEL_AUTO_REGISTER=false; off returns the SAP import to the old raw creation of a
 * master vessel. Read on every call, so it can be switched without a code change; a leaf file so the resolver can read it without importing the
 * service that imports the resolver.
 */
export function isVesselAutoRegisterEnabled(): boolean {
  return String(process.env.VESSEL_AUTO_REGISTER ?? 'true').trim().toLowerCase() !== 'false';
}
