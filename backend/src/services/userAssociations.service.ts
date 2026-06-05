import { query } from '../database/connection';

export type UserScopeAssociations = {
  plants: string[];
  group_plants: string[];
  products: string[];
};

export async function fetchUserScopeAssociations(
  userId: string,
  legacyPlant: string | null | undefined,
): Promise<UserScopeAssociations> {
  const [plantsResult, productsResult, groupPlantsResult] = await Promise.all([
    query(
      `SELECT mp.plant_name
       FROM user_plants up
       JOIN master_plants mp ON mp.id = up.master_plant_id
       WHERE up.user_id = $1
       ORDER BY mp.plant_name`,
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
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(mp.group_plant), ''), 'Blank') AS group_plant
       FROM user_plants up
       JOIN master_plants mp ON mp.id = up.master_plant_id
       WHERE up.user_id = $1
       ORDER BY group_plant`,
      [userId],
    ),
  ]);

  let plants = plantsResult.rows.map((row) => String(row.plant_name));
  let group_plants = groupPlantsResult.rows.map((row) => String(row.group_plant));
  const products = productsResult.rows.map((row) => String(row.product_name));

  const legacy = typeof legacyPlant === 'string' ? legacyPlant.trim() : '';
  if (plants.length === 0 && legacy) {
    plants = [legacy];
    const legacyGroupResult = await query(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(group_plant), ''), 'Blank') AS group_plant
       FROM master_plants
       WHERE TRIM(LOWER(plant_name)) = TRIM(LOWER($1))
       ORDER BY group_plant`,
      [legacy],
    );
    group_plants = legacyGroupResult.rows.map((row) => String(row.group_plant));
  }

  return { plants, group_plants, products };
}
