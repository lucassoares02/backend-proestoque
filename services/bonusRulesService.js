const pool = require("../db");

const RULE_SQL = `
  SELECT
    r.*,
    tp.name             AS trigger_product_name,
    tp.sku              AS trigger_product_sku,
    (SELECT pi.url FROM products_images pi WHERE pi.product_id = tp.id ORDER BY pi.sort_order LIMIT 1) AS trigger_product_image,
    tv.name             AS trigger_variant_name,
    tv.image_url        AS trigger_variant_image,
    tpk.quantity        AS trigger_package_units,
    tpkg.title          AS trigger_package_title,
    tpk.package_id      AS trigger_package_pack_id,

    bp.name             AS bonus_product_name,
    bp.sku              AS bonus_product_sku,
    (SELECT pi.url FROM products_images pi WHERE pi.product_id = bp.id ORDER BY pi.sort_order LIMIT 1) AS bonus_product_image,
    bv.name             AS bonus_variant_name,
    bv.image_url        AS bonus_variant_image,
    bpk.quantity        AS bonus_package_units,
    bpkg.title          AS bonus_package_title,
    bpk.package_id      AS bonus_package_pack_id
  FROM bonus_rules r
  LEFT JOIN products          tp   ON tp.id   = r.trigger_product_id
  LEFT JOIN product_variants  tv   ON tv.id   = r.trigger_variant_id
  LEFT JOIN products_packages tpk  ON tpk.id  = r.trigger_package_id
  LEFT JOIN packages          tpkg ON tpkg.id = tpk.package_id
  LEFT JOIN products          bp   ON bp.id   = r.bonus_product_id
  LEFT JOIN product_variants  bv   ON bv.id   = r.bonus_variant_id
  LEFT JOIN products_packages bpk  ON bpk.id  = r.bonus_package_id
  LEFT JOIN packages          bpkg ON bpkg.id = bpk.package_id
`;

const findAll = async (companyId) => {
  const result = await pool.query(
    `${RULE_SQL} WHERE r.company_id = $1 ORDER BY r.id DESC`,
    [companyId],
  );
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query(
    `${RULE_SQL} WHERE r.id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

// Active rules — used by the client cart to preview/auto-apply bonuses.
const findActiveBySupplier = async (supplierId) => {
  const now = new Date().toISOString();
  const result = await pool.query(
    `${RULE_SQL}
     WHERE r.company_id = $1
       AND r.is_active = true
       AND (r.starts_at IS NULL OR r.starts_at <= $2)
       AND (r.ends_at   IS NULL OR r.ends_at   >= $2)
     ORDER BY r.id`,
    [supplierId, now],
  );
  return result.rows;
};

const findActiveByProduct = async (supplierId, productId) => {
  const now = new Date().toISOString();
  const result = await pool.query(
    `${RULE_SQL}
     WHERE r.company_id = $1
       AND r.trigger_product_id = $2
       AND r.is_active = true
       AND (r.starts_at IS NULL OR r.starts_at <= $3)
       AND (r.ends_at   IS NULL OR r.ends_at   >= $3)
     ORDER BY r.minimum_quantity ASC`,
    [supplierId, productId, now],
  );
  return result.rows;
};

// Reuse the buy_together product list (same shape: variants + packages).
const buyTogetherService = require("./buyTogetherService");
const getProducts = (companyId) => buyTogetherService.getProducts(companyId);

const create = async (data) => {
  const {
    companyId,
    name,
    description,
    triggerProductId,
    triggerVariantId,
    triggerPackageId,
    minimumQuantity,
    bonusProductId,
    bonusVariantId,
    bonusPackageId,
    bonusQuantity,
    isActive,
    startsAt,
    endsAt,
  } = data;

  if (!triggerProductId) throw new Error("Produto gatilho obrigatório");
  if (!bonusProductId) throw new Error("Produto bonificado obrigatório");
  if (!minimumQuantity || minimumQuantity <= 0) {
    throw new Error("Quantidade mínima deve ser maior que zero");
  }
  if (!bonusQuantity || bonusQuantity <= 0) {
    throw new Error("Quantidade bonificada deve ser maior que zero");
  }

  const result = await pool.query(
    `INSERT INTO bonus_rules
      (company_id, name, description,
       trigger_product_id, trigger_variant_id, trigger_package_id, minimum_quantity,
       bonus_product_id,   bonus_variant_id,   bonus_package_id,   bonus_quantity,
       is_active, starts_at, ends_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW(), NOW())
     RETURNING id`,
    [
      companyId,
      name ?? null,
      description ?? null,
      triggerProductId,
      triggerVariantId ?? null,
      triggerPackageId ?? null,
      minimumQuantity,
      bonusProductId,
      bonusVariantId ?? null,
      bonusPackageId ?? null,
      bonusQuantity,
      isActive ?? true,
      startsAt ?? null,
      endsAt ?? null,
    ],
  );
  return await find(result.rows[0].id);
};

const update = async (data) => {
  const {
    id,
    name,
    description,
    triggerProductId,
    triggerVariantId,
    triggerPackageId,
    minimumQuantity,
    bonusProductId,
    bonusVariantId,
    bonusPackageId,
    bonusQuantity,
    isActive,
    startsAt,
    endsAt,
  } = data;

  if (!triggerProductId) throw new Error("Produto gatilho obrigatório");
  if (!bonusProductId) throw new Error("Produto bonificado obrigatório");
  if (!minimumQuantity || minimumQuantity <= 0) {
    throw new Error("Quantidade mínima deve ser maior que zero");
  }
  if (!bonusQuantity || bonusQuantity <= 0) {
    throw new Error("Quantidade bonificada deve ser maior que zero");
  }

  const result = await pool.query(
    `UPDATE bonus_rules
       SET name = $1,
           description = $2,
           trigger_product_id = $3,
           trigger_variant_id = $4,
           trigger_package_id = $5,
           minimum_quantity = $6,
           bonus_product_id = $7,
           bonus_variant_id = $8,
           bonus_package_id = $9,
           bonus_quantity = $10,
           is_active = $11,
           starts_at = $12,
           ends_at = $13,
           updated_at = NOW()
     WHERE id = $14
     RETURNING id`,
    [
      name ?? null,
      description ?? null,
      triggerProductId,
      triggerVariantId ?? null,
      triggerPackageId ?? null,
      minimumQuantity,
      bonusProductId,
      bonusVariantId ?? null,
      bonusPackageId ?? null,
      bonusQuantity,
      isActive ?? true,
      startsAt ?? null,
      endsAt ?? null,
      id,
    ],
  );
  if (result.rowCount === 0) return null;
  return await find(id);
};

const remove = async (id) => {
  const result = await pool.query(
    "DELETE FROM bonus_rules WHERE id = $1 RETURNING *",
    [id],
  );
  return result.rows[0] || null;
};

module.exports = {
  findAll,
  find,
  findActiveBySupplier,
  findActiveByProduct,
  getProducts,
  create,
  update,
  remove,
};
