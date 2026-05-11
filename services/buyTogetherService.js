const pool = require("../db");

const CAMPAIGN_WITH_PRODUCTS_SQL = `
  SELECT
    c.*,
    t_item.id            AS trigger_item_id,
    t_item.product_id    AS trigger_product_id,
    t_item.min_quantity  AS trigger_min_quantity,
    tp.name              AS trigger_product_name,
    tp.sku               AS trigger_product_sku,
    (SELECT pi.url FROM products_images pi WHERE pi.product_id = tp.id ORDER BY pi.sort_order LIMIT 1) AS trigger_product_image,
    tgt_item.id          AS target_item_id,
    tgt_item.product_id  AS target_product_id,
    tgtp.name            AS target_product_name,
    tgtp.sku             AS target_product_sku,
    (SELECT pi.url FROM products_images pi WHERE pi.product_id = tgtp.id ORDER BY pi.sort_order LIMIT 1) AS target_product_image
  FROM buy_together_campaigns c
  LEFT JOIN buy_together_campaign_items t_item
    ON t_item.campaign_id = c.id AND t_item.role = 'trigger'
  LEFT JOIN products tp ON tp.id = t_item.product_id
  LEFT JOIN buy_together_campaign_items tgt_item
    ON tgt_item.campaign_id = c.id AND tgt_item.role = 'target'
  LEFT JOIN products tgtp ON tgtp.id = tgt_item.product_id
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
    `SELECT p.id, p.name, p.sku,
       (SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image
     FROM products p
     WHERE p.company_id = $1 AND p.active = true
     ORDER BY p.name`,
    [companyId],
  );
  return result.rows;
};

const create = async (data) => {
  const { companyId, name, description, discountType, discountValue, startsAt, endsAt, active, triggerProductId, triggerMinQuantity, targetProductId } = data;

  if (!triggerProductId) throw new Error("Produto gatilho obrigatório");
  if (!targetProductId) throw new Error("Produto incentivado obrigatório");
  if (!triggerMinQuantity || triggerMinQuantity <= 0) throw new Error("Quantidade mínima deve ser maior que zero");
  if (!discountValue || discountValue <= 0) throw new Error("Valor do desconto deve ser maior que zero");

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
      `INSERT INTO buy_together_campaign_items (campaign_id, product_id, role, min_quantity, created_at)
       VALUES ($1, $2, 'trigger', $3, NOW())`,
      [campaign.id, triggerProductId, triggerMinQuantity],
    );

    await client.query(
      `INSERT INTO buy_together_campaign_items (campaign_id, product_id, role, min_quantity, created_at)
       VALUES ($1, $2, 'target', NULL, NOW())`,
      [campaign.id, targetProductId],
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
  const { id, companyId, name, description, discountType, discountValue, startsAt, endsAt, active, triggerProductId, triggerMinQuantity, targetProductId } = data;

  if (!triggerProductId) throw new Error("Produto gatilho obrigatório");
  if (!targetProductId) throw new Error("Produto incentivado obrigatório");
  if (!triggerMinQuantity || triggerMinQuantity <= 0) throw new Error("Quantidade mínima deve ser maior que zero");
  if (!discountValue || discountValue <= 0) throw new Error("Valor do desconto deve ser maior que zero");

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
      `INSERT INTO buy_together_campaign_items (campaign_id, product_id, role, min_quantity, created_at)
       VALUES ($1, $2, 'trigger', $3, NOW())`,
      [id, triggerProductId, triggerMinQuantity],
    );

    await client.query(
      `INSERT INTO buy_together_campaign_items (campaign_id, product_id, role, min_quantity, created_at)
       VALUES ($1, $2, 'target', NULL, NOW())`,
      [id, targetProductId],
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
       AND c.starts_at <= $2
       AND c.ends_at >= $2`,
    [supplierId, now],
  );

  const eligible = [];
  for (const campaign of campaignsResult.rows) {
    const triggerInCart = cartItems.find(
      (item) =>
        item.productId === campaign.trigger_product_id &&
        item.quantity >= campaign.trigger_min_quantity,
    );
    if (!triggerInCart) continue;

    const targetAlreadyInCart = cartItems.find(
      (item) => item.productId === campaign.target_product_id,
    );
    if (targetAlreadyInCart) continue;

    // Busca preço original do produto alvo
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
        // fixed_price: discount_value é o preço final
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
    });
  }

  return eligible;
};

module.exports = { findAll, find, getProducts, create, update, remove, validateCart };
