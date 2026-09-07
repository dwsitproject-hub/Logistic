/**
 * OS Qty at or below this band (kg) counts as fulfilled - "± 0 MT" in the user's words.
 * Aligned with whole-MT table display (`maxFractionDigits: 0`): residual OS ≤ 499 kg → "0 MT".
 * Also treats over-delivery (negative OS / UI "+N MT") as fulfilled - any OS ≤ 499 kg qualifies.
 * Example: contract 225,000 kg − receive 224,714 kg = 286 kg OS → fulfilled despite GR Open.
 *
 * Lives in its own leaf module because both contractDeliveryStatus and truckingQuantitySql need
 * it and truckingQuantitySql already imports contractDeliveryStatus - importing it the other way
 * would be a cycle.
 */
export const OUTSTANDING_QTY_ZERO_TOLERANCE_KG = 499;
