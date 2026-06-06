const pool = require("../db");

const CAMPAIGN_WITH_PRODUCTS_SQL = `
  SELECT
    c.*,
    t_item.id                  AS trigger_item_id,
    t_item.product_id          AS trigger_product_id,
    t_item.variant_id          AS trigger_variant_id,
    t_item.product_package_id  AS trigger_package_id,
    t_item.min_quantity        AS trigger_min_quantity,
    tp.name                    AS trigger_product_name,
    tp.sku                     AS trigger_product_sku,
    (SELECT pi.url FROM products_images pi WHERE pi.product_id = tp.id ORDER BY pi.sort_order LIMIT 1) AS trigger_product_image,
    tv.name                    AS trigger_variant_name,
    tv.image_url               AS trigger_variant_image,
    tpk.package_id             AS trigger_package_pack_id,
    tpk.quantity               AS trigger_package_units,
    tpkg.title                 AS trigger_package_title,
    tgt_item.id                AS target_item_id,
    tgt_item.product_id        AS target_product_id,
    tgt_item.variant_id        AS target_variant_id,
    tgt_item.product_package_id AS target_package_id,
    tgt_item.min_quantity      AS target_min_quantity,
    tgtp.name                  AS target_product_name,
    tgtp.sku                   AS target_product_sku,
    (SELECT pi.url FROM products_images pi WHERE pi.product_id = tgtp.id ORDER BY pi.sort_order LIMIT 1) AS target_product_image,
    tgtv.name                  AS target_variant_name,
    tgtv.image_url             AS target_variant_image,
    tgtpk.package_id           AS target_package_pack_id,
    tgtpk.quantity             AS target_package_units,
    tgtpkg.title               AS target_package_title
  FROM buy_together_campaigns c
  LEFT JOIN buy_together_campaign_items t_item
    ON t_item.campaign_id = c.id AND t_item.role = 'trigger'
  LEFT JOIN products tp                ON tp.id   = t_item.product_id
  LEFT JOIN product_variants tv        ON tv.id   = t_item.variant_id
  LEFT JOIN products_packages tpk      ON tpk.id  = t_item.product_package_id
  LEFT JOIN packages tpkg              ON tpkg.id = tpk.package_id
  LEFT JOIN buy_together_campaign_items tgt_item
    ON tgt_item.campaign_id = c.id AND tgt_item.role = 'target'
  LEFT JOIN products tgtp              ON tgtp.id   = tgt_item.product_id
  LEFT JOIN product_variants tgtv      ON tgtv.id   = tgt_item.variant_id
  LEFT JOIN products_packages tgtpk    ON tgtpk.id  = tgt_item.product_package_id
  LEFT JOIN packages tgtpkg            ON tgtpkg.id = tgtpk.package_id
`;

const findAll = async (companyId) => {
  const result = await pool.query(
    `${CAMPAIGN_WITH_PRODUCTS_SQL} WHERE c.company_id = $1 ORDER BY c.id DESC`,
    [companyId],
  );
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query(
    `${CAMPAIGN_WITH_PRODUCTS_SQL} WHERE c.id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

const getProducts = async (companyId) => {
  const result = await pool.query(
    `SELECT
        p.id,
        p.name,
        p.sku,
        b.name AS brand_name,
        (SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id',        pv.id,
            'name',      pv.name,
            'sku',       pv.sku,
            'image_url', pv.image_url
          ) ORDER BY pv.sort_order, pv.id)
          FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.active = true
        ), '[]') AS variants,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id',         pk.id,
            'package_id', pk.package_id,
            'title',      pkg.title,
            'units',      pk.quantity
          ) ORDER BY pk.quantity NULLS LAST, pk.id)
          FROM products_packages pk
          JOIN packages pkg ON pkg.id = pk.package_id
          WHERE pk.product_id = p.id
        ), '[]') AS packages
     FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.company_id = $1 AND p.active = true
     ORDER BY p.name`,
    [companyId],
  );
  return result.rows;
};

const create = async (data) => {
  const {
    companyId,
    name,
    description,
    discountType,
    discountValue,
    startsAt,
    endsAt,
    active,
    triggerProductId,
    triggerVariantId,
    triggerPackageId,
    triggerMinQuantity,
    targetProductId,
    targetVariantId,
    targetPackageId,
  } = data;

  if (!triggerProductId) throw new Error("Produto gatilho obrigatório");
  if (!targetProductId) throw new Error("Produto incentivado obrigatório");
  if (!triggerMinQuantity || triggerMinQuantity <= 0) throw new Error("Quantidade mínima deve ser maior que zero");
  if (!discountValue || discountValue <= 0) throw new Error("Valor do desconto deve ser maior que zero");

  if (
    triggerProductId === targetProductId &&
    (triggerVariantId ?? null) === (targetVariantId ?? null)
  ) {
    throw new Error(
      "Produto gatilho e incentivado não podem ser o mesmo (com a mesma variação)",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const campaignResult = await client.query(
      `INSERT INTO buy_together_campaigns
        (company_id, name, description, discount_type, discount_value, starts_at, ends_at, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [companyId, name, description, discountType, discountValue, startsAt, endsAt, active ?? true],
    );

    const campaign = campaignResult.rows[0];

    await client.query(
      `INSERT INTO buy_together_campaign_items
         (campaign_id, product_id, variant_id, product_package_id, role, min_quantity, created_at)
       VALUES ($1, $2, $3, $4, 'trigger', $5, NOW())`,
      [campaign.id, triggerProductId, triggerVariantId ?? null, triggerPackageId ?? null, triggerMinQuantity],
    );

    await client.query(
      `INSERT INTO buy_together_campaign_items
         (campaign_id, product_id, variant_id, product_package_id, role, min_quantity, created_at)
       VALUES ($1, $2, $3, $4, 'target', NULL, NOW())`,
      [campaign.id, targetProductId, targetVariantId ?? null, targetPackageId ?? null],
    );

    await client.query("COMMIT");
    return await find(campaign.id);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const update = async (data) => {
  const {
    id,
    companyId,
    name,
    description,
    discountType,
    discountValue,
    startsAt,
    endsAt,
    active,
    triggerProductId,
    triggerVariantId,
    triggerPackageId,
    triggerMinQuantity,
    targetProductId,
    targetVariantId,
    targetPackageId,
  } = data;

  if (!triggerProductId) throw new Error("Produto gatilho obrigatório");
  if (!targetProductId) throw new Error("Produto incentivado obrigatório");
  if (!triggerMinQuantity || triggerMinQuantity <= 0) throw new Error("Quantidade mínima deve ser maior que zero");
  if (!discountValue || discountValue <= 0) throw new Error("Valor do desconto deve ser maior que zero");

  if (
    triggerProductId === targetProductId &&
    (triggerVariantId ?? null) === (targetVariantId ?? null)
  ) {
    throw new Error(
      "Produto gatilho e incentivado não podem ser o mesmo (com a mesma variação)",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const campaignResult = await client.query(
      `UPDATE buy_together_campaigns
       SET company_id = $1, name = $2, description = $3, discount_type = $4,
           discount_value = $5, starts_at = $6, ends_at = $7, active = $8, updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [companyId, name, description, discountType, discountValue, startsAt, endsAt, active, id],
    );

    if (campaignResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query("DELETE FROM buy_together_campaign_items WHERE campaign_id = $1", [id]);

    await client.query(
      `INSERT INTO buy_together_campaign_items
         (campaign_id, product_id, variant_id, product_package_id, role, min_quantity, created_at)
       VALUES ($1, $2, $3, $4, 'trigger', $5, NOW())`,
      [id, triggerProductId, triggerVariantId ?? null, triggerPackageId ?? null, triggerMinQuantity],
    );

    await client.query(
      `INSERT INTO buy_together_campaign_items
         (campaign_id, product_id, variant_id, product_package_id, role, min_quantity, created_at)
       VALUES ($1, $2, $3, $4, 'target', NULL, NOW())`,
      [id, targetProductId, targetVariantId ?? null, targetPackageId ?? null],
    );

    await client.query("COMMIT");
    return await find(id);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const remove = async (id) => {
  const result = await pool.query(
    "DELETE FROM buy_together_campaigns WHERE id = $1 RETURNING *",
    [id],
  );
  return result.rows[0] || null;
};

const validateCart = async (supplierId, cartItems) => {
  if (!cartItems || cartItems.length === 0) return [];

  const now = new Date().toISOString();
  const campaignsResult = await pool.query(
    `${CAMPAIGN_WITH_PRODUCTS_SQL}
     WHERE c.company_id = $1
       AND c.active = true
       AND (c.starts_at IS NULL OR c.starts_at <= $2)
       AND (c.ends_at IS NULL OR c.ends_at >= $2)`,
    [supplierId, now],
  );

  const eligible = [];
  for (const campaign of campaignsResult.rows) {
    const triggerInCart = cartItems.find(
      (item) =>
        item.productId === campaign.trigger_product_id &&
        (campaign.trigger_variant_id == null ||
          item.variantId === campaign.trigger_variant_id) &&
        item.quantity >= campaign.trigger_min_quantity,
    );
    if (!triggerInCart) continue;

    // Quantas vezes o gatilho foi atingido define quantos itens com desconto
    // o cliente pode levar. Ex.: gatilho de 10 un. com 20 no carrinho => 2.
    const maxRedeemableQuantity = Math.max(
      1,
      Math.floor(triggerInCart.quantity / campaign.trigger_min_quantity),
    );

    const targetAlreadyInCart = cartItems.find(
      (item) =>
        item.productId === campaign.target_product_id &&
        (campaign.target_variant_id == null ||
          item.variantId === campaign.target_variant_id),
    );
    if (targetAlreadyInCart) continue;

    const priceRes = await pool.query(
      `SELECT unit_price FROM products_prices
       WHERE product_id = $1
       ORDER BY qty_min ASC
       LIMIT 1`,
      [campaign.target_product_id],
    );

    const originalPrice = priceRes.rows[0]?.unit_price != null
      ? parseFloat(priceRes.rows[0].unit_price)
      : null;

    let discountedPrice = null;
    let savingsAmount = null;

    if (originalPrice !== null) {
      if (campaign.discount_type === 'percentage') {
        discountedPrice = parseFloat((originalPrice * (1 - campaign.discount_value / 100)).toFixed(2));
        savingsAmount = parseFloat((originalPrice - discountedPrice).toFixed(2));
      } else {
        discountedPrice = parseFloat(campaign.discount_value);
        savingsAmount = originalPrice > discountedPrice
          ? parseFloat((originalPrice - discountedPrice).toFixed(2))
          : 0;
      }
    }

    eligible.push({
      ...campaign,
      original_price: originalPrice,
      discounted_price: discountedPrice,
      savings_amount: savingsAmount,
      max_redeemable_quantity: maxRedeemableQuantity,
    });
  }

  return eligible;
};

module.exports = { findAll, find, getProducts, create, update, remove, validateCart };
