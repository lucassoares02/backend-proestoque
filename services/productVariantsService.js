const pool = require("../db");

const _pricesTableExists = async () => {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'product_variant_prices' LIMIT 1`
  );
  return rows.length > 0;
};

// Flat list of the product's price tiers — used by the variant form to build its UI.
// Returns one row per products_prices entry with package metadata.
const getProductPriceTiers = async (productId) => {
  const { rows } = await pool.query(
    `SELECT
       pp.id         AS price_id,
       pkg.title     AS package_title,
       pk.quantity   AS pack_units,
       pp.qty_min,
       pp.qty_max,
       pp.unit_price
     FROM products_prices pp
     JOIN products_packages pk ON pk.id = pp.product_package_id
     JOIN packages pkg          ON pkg.id = pk.package_id
     WHERE pp.product_id = $1
     ORDER BY pkg.title, pp.qty_min`,
    [productId]
  );
  return rows;
};

const findByProduct = async (productId) => {
  const hasPrices = await _pricesTableExists();
  const sql = hasPrices
    ? `SELECT v.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id',               vp.id,
               'product_price_id', vp.product_price_id,
               'unit_price',       vp.unit_price,
               'is_overridden',    vp.is_overridden
             ) ORDER BY vp.product_price_id
           ) FILTER (WHERE vp.id IS NOT NULL),
           '[]'
         ) AS prices
       FROM product_variants v
       LEFT JOIN product_variant_prices vp ON vp.variant_id = v.id
       WHERE v.product_id = $1
       GROUP BY v.id
       ORDER BY v.sort_order, v.id`
    : `SELECT *, '[]'::json AS prices FROM product_variants WHERE product_id = $1 ORDER BY sort_order, id`;

  const { rows } = await pool.query(sql, [productId]);
  return rows;
};

const findOne = async (productId, variantId) => {
  const hasPrices = await _pricesTableExists();
  const sql = hasPrices
    ? `SELECT v.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id',               vp.id,
               'product_price_id', vp.product_price_id,
               'unit_price',       vp.unit_price,
               'is_overridden',    vp.is_overridden
             ) ORDER BY vp.product_price_id
           ) FILTER (WHERE vp.id IS NOT NULL),
           '[]'
         ) AS prices
       FROM product_variants v
       LEFT JOIN product_variant_prices vp ON vp.variant_id = v.id
       WHERE v.id = $1 AND v.product_id = $2
       GROUP BY v.id`
    : `SELECT *, '[]'::json AS prices FROM product_variants WHERE id = $1 AND product_id = $2`;

  const { rows } = await pool.query(sql, [variantId, productId]);
  return rows[0] || null;
};

const _validateName = (name) => {
  if (!name || !name.trim()) {
    const err = new Error("O nome da variação é obrigatório.");
    err.status = 422;
    throw err;
  }
};

// prices: [{ product_price_id, unit_price, is_overridden }]
const _replacePrices = async (client, variantId, prices) => {
  await client.query(`DELETE FROM product_variant_prices WHERE variant_id = $1`, [variantId]);
  if (!prices || prices.length === 0) return;
  for (const p of prices) {
    await client.query(
      `INSERT INTO product_variant_prices (variant_id, product_price_id, unit_price, is_overridden)
       VALUES ($1, $2, $3, $4)`,
      [variantId, Number(p.product_price_id), Number(p.unit_price), p.is_overridden === true]
    );
  }
};

const create = async (productId, data) => {
  const { name, sku, ean, weight, content, image_url, active, sort_order, prices } = data;
  _validateName(name);

  const hasPrices = await _pricesTableExists();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO product_variants
         (product_id, name, sku, ean, weight, content, image_url, active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        productId,
        name.trim(),
        sku?.trim() || null,
        ean?.trim() || null,
        weight != null ? Number(weight) : null,
        content != null ? Number(content) : null,
        image_url?.trim() || null,
        active !== false,
        Number(sort_order) || 0,
      ]
    );
    const variant = rows[0];
    if (hasPrices && Array.isArray(prices) && prices.length > 0) {
      await _replacePrices(client, variant.id, prices);
    }
    await client.query("COMMIT");
    return { ...variant, prices: prices || [] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const update = async (productId, variantId, data) => {
  const { name, sku, ean, weight, content, image_url, active, sort_order, prices } = data;
  _validateName(name);

  const hasPrices = await _pricesTableExists();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE product_variants SET
         name       = $1,
         sku        = $2,
         ean        = $3,
         weight     = $4,
         content    = $5,
         image_url  = $6,
         active     = $7,
         sort_order = $8,
         updated_at = NOW()
       WHERE id = $9 AND product_id = $10
       RETURNING *`,
      [
        name.trim(),
        sku?.trim() || null,
        ean?.trim() || null,
        weight != null ? Number(weight) : null,
        content != null ? Number(content) : null,
        image_url?.trim() || null,
        active !== false,
        Number(sort_order) || 0,
        variantId,
        productId,
      ]
    );
    const variant = rows[0] || null;
    if (variant && hasPrices && Array.isArray(prices)) {
      await _replacePrices(client, variantId, prices);
    }
    await client.query("COMMIT");
    return variant ? { ...variant, prices: prices || [] } : null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const remove = async (productId, variantId) => {
  const { rows } = await pool.query(
    `DELETE FROM product_variants WHERE id = $1 AND product_id = $2 RETURNING *`,
    [variantId, productId]
  );
  return rows[0] || null;
};

// Returns how many variants of the product have at least one price with is_overridden = true.
const getOverriddenCount = async (productId) => {
  const hasPrices = await _pricesTableExists();
  if (!hasPrices) return 0;
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT vp.variant_id)::int AS count
     FROM product_variant_prices vp
     JOIN product_variants v ON v.id = vp.variant_id
     WHERE v.product_id = $1 AND vp.is_overridden = true`,
    [productId]
  );
  return rows[0]?.count ?? 0;
};

// Resets all variant prices for the product to inherit the main product's prices.
// Overwrites unit_price and sets is_overridden = false for every variant price row.
const syncAllPrices = async (productId) => {
  const hasPrices = await _pricesTableExists();
  if (!hasPrices) throw Object.assign(new Error('product_variant_prices table does not exist'), { status: 503 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch all current price tiers for this product
    const { rows: priceTiers } = await client.query(
      `SELECT id, unit_price FROM products_prices WHERE product_id = $1`,
      [productId]
    );

    // Reset every variant price: match by product_price_id, set inherited value and clear override flag
    for (const tier of priceTiers) {
      await client.query(
        `UPDATE product_variant_prices
         SET unit_price = $1, is_overridden = false, updated_at = NOW()
         WHERE product_price_id = $2`,
        [tier.unit_price, tier.id]
      );
    }

    await client.query('COMMIT');
    return { synced: priceTiers.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

module.exports = { findByProduct, findOne, getProductPriceTiers, getOverriddenCount, syncAllPrices, create, update, remove };
