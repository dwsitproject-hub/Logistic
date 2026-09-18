import { query } from '../database/connection';
import { canonicalizeUserRegionSites } from '../utils/userRegionSite';

export type UserScopeAssociations = {
  plants: string[];
  group_plants: string[];
  products: string[];
};

/**
 * The legacy `users.plant` column is no longer a parameter. It was resolved through
 * master_plants.plant_name -> group_plant, the plant dimension migration 177 retired, and keeping
 * it as a fallback would hand a user a scope in the wrong dimension exactly when their Region/Site
 * is empty - the state an admin creates on purpose. Removing the argument rather than ignoring it
 * means no caller can pass it back in by habit.
 */
export async function fetchUserScopeAssociations(
  userId: string,
): Promise<UserScopeAssociations> {
  const [plantsResult, productsResult, groupPlantsResult] = await Promise.all([
    /*
     * Region/Site, as the admin picked it from the SAP Discharge Destination list. `plants` and
     * `group_plants` are the same values: the Users page offers one picker, and the legacy
     * distinction between a plant name and its group belonged to the dimension migration 177
     * retired. Keeping both keys means no caller has to change.
     */
    query(
      `SELECT region_site AS plant_name
       FROM user_region_sites
       WHERE user_id = $1
       ORDER BY region_site`,
      [userId],
    ),
    query(
      `SELECT p.product_name
       FROM user_products up
       JOIN products p ON p.id = up.product_id
       WHERE up.user_id = $1
       ORDER BY p.product_name`,
      [userId],
    ),
    query(
      `SELECT region_site AS group_plant
       FROM user_region_sites
       WHERE user_id = $1
       ORDER BY region_site`,
      [userId],
    ),
  ]);

  const plants = plantsResult.rows.map((row) => String(row.plant_name));
  const group_plants = canonicalizeUserRegionSites(
    groupPlantsResult.rows.map((row) => row.group_plant),
  );
  const products = productsResult.rows.map((row) => String(row.product_name));

  /*
   * The legacy `plant` text column is deliberately NOT consulted any more. It was resolved through
   * master_plants.plant_name -> group_plant, which is the plant dimension migration 177 retired;
   * using it as a fallback would hand a user a scope in the wrong dimension precisely when their
   * Region/Site is empty, which is the state an admin creates on purpose.
   */
  return { plants, group_plants, products };
}
