const pool = require("../db");

const getSuggestions = async (supplierId, cartItems) => {
  if (!cartItems || cartItems.length === 0) return [];

  const cartProductIds = cartItems
    .map((item) => item.product_id ?? item.productId)
    .filter(Boolean)
    .map(Number);

  if (cartProductIds.length === 0) return [];

  const now = new Date().toISOString();
  const suggestions = [];
  const suggestedProductIds = new Set();

  // ─── Priority 1: buy_together eligible campaigns ─────────────────
  const btResult = await pool.query(
    `SELECT
       c.id              AS campaign_id,
       c.discount_type,
       c.discount_value,
       t_item.product_id   AS trigger_product_id,
       t_item.min_quantity AS trigger_min_quantity,
       tgt_item.product_id AS target_product_id,
       tgtp.name           AS target_product_name,
       tgtp.category_id    AS target_category_id,
       (SELECT pi.url FROM products_images pi
        WHERE pi.product_id = tgtp.id ORDER BY pi.sort_order LIMIT 1) AS target_image
     FROM buy_together_campaigns c
     JOIN buy_together_campaign_items t_item
       ON t_item.campaign_id = c.id AND t_item.role = 'trigger'
     JOIN buy_together_campaign_items tgt_item
       ON tgt_item.campaign_id = c.id AND tgt_item.role = 'target'
     JOIN products tgtp ON tgtp.id = tgt_item.product_id
     WHERE c.company_id = $1
       AND c.active = true
       AND c.starts_at <= $2
       AND c.ends_at >= $2
       AND tgtp.active = true
       AND t_item.product_id = ANY($3::int[])
       AND NOT (tgt_item.product_id = ANY($3::int[]))`,
    [supplierId, now, cartProductIds],
  );

  for (const row of btResult.rows) {
    if (suggestedProductIds.has(row.target_product_id)) continue;

    const triggerInCart = cartItems.find(
      (item) =>
        Number(item.product_id ?? item.productId) === row.trigger_product_id &&
        Number(item.quantity ?? 1) >= row.trigger_min_quantity,
    );
    if (!triggerInCart) continue;

    const priceRes = await pool.query(
      `SELECT unit_price FROM products_prices
       WHERE product_id = $1 ORDER BY qty_min ASC LIMIT 1`,
      [row.target_product_id],
    );
    if (!priceRes.rows.length) continue;

    const originalPrice = parseFloat(priceRes.rows[0].unit_price);
    const discountedPrice =
      row.discount_type === "percentage"
        ? parseFloat((originalPrice * (1 - row.discount_value / 100)).toFixed(2))
        : parseFloat(row.discount_value);

    suggestions.push({
      product_id: row.target_product_id,
      name: row.target_product_name,
      image: row.target_image,
      price: originalPrice,
      category_id: row.target_category_id,
      suggestion_type: "buy_together",
      campaign_id: row.campaign_id,
      discount_type: row.discount_type,
      discount_value: parseFloat(row.discount_value),
      discounted_price: discountedPrice,
    });
    suggestedProductIds.add(row.target_product_id);
  }

  // ─── Priority 2: mesma categoria OU mesma marca ───────────────────
  const remaining = 10 - suggestions.length;
  if (remaining > 0) {
    const excluded = [...cartProductIds, ...Array.from(suggestedProductIds)];

    const catBrandResult = await pool.query(
      `WITH cart_info AS (
         SELECT DISTINCT p.category_id, p.brand
         FROM products p
         WHERE p.id = ANY($2::int[])
       )
       SELECT DISTINCT ON (p.id)
         p.id           AS product_id,
         p.name,
         p.category_id,
         p.brand,
         (SELECT pi.url FROM products_images pi
          WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image,
         (SELECT pp.unit_price FROM products_prices pp
          WHERE pp.product_id = p.id ORDER BY pp.qty_min ASC LIMIT 1) AS price,
         CASE
           WHEN p.category_id IS NOT NULL
             AND p.category_id IN (SELECT category_id FROM cart_info WHERE category_id IS NOT NULL)
           THEN 'same_category'
           ELSE 'same_brand'
         END AS suggestion_type
       FROM products p
       WHERE p.company_id = $1
         AND p.active = true
         AND (
           (p.category_id IS NOT NULL
             AND p.category_id IN (SELECT category_id FROM cart_info WHERE category_id IS NOT NULL))
           OR
           (p.brand IS NOT NULL AND p.brand <> ''
             AND p.brand IN (SELECT brand FROM cart_info WHERE brand IS NOT NULL AND brand <> ''))
         )
         AND NOT (p.id = ANY($3::int[]))
         AND EXISTS (SELECT 1 FROM products_prices pp WHERE pp.product_id = p.id)
       ORDER BY p.id DESC
       LIMIT $4`,
      [supplierId, cartProductIds, excluded, remaining],
    );

    for (const row of catBrandResult.rows) {
      if (!row.price) continue;
      suggestions.push({
        product_id: row.product_id,
        name: row.name,
        image: row.image,
        price: parseFloat(row.price),
        category_id: row.category_id,
        suggestion_type: row.suggestion_type,
        campaign_id: null,
        discount_type: null,
        discount_value: null,
        discounted_price: null,
      });
      suggestedProductIds.add(row.product_id);
    }
  }

  // ─── Fallback: produtos recentes do fornecedor ────────────────────
  // Garante que a sessão sempre tenha conteúdo
  const remaining2 = 10 - suggestions.length;
  if (remaining2 > 0) {
    const excluded2 = [...cartProductIds, ...Array.from(suggestedProductIds)];

    const fallbackResult = await pool.query(
      `SELECT
         p.id AS product_id,
         p.name,
         p.category_id,
         p.brand,
         (SELECT pi.url FROM products_images pi
          WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image,
         (SELECT pp.unit_price FROM products_prices pp
          WHERE pp.product_id = p.id ORDER BY pp.qty_min ASC LIMIT 1) AS price
       FROM products p
       WHERE p.company_id = $1
         AND p.active = true
         AND NOT (p.id = ANY($2::int[]))
         AND EXISTS (SELECT 1 FROM products_prices pp WHERE pp.product_id = p.id)
       ORDER BY p.id DESC
       LIMIT $3`,
      [supplierId, excluded2, remaining2],
    );

    for (const row of fallbackResult.rows) {
      if (!row.price) continue;
      suggestions.push({
        product_id: row.product_id,
        name: row.name,
        image: row.image,
        price: parseFloat(row.price),
        category_id: row.category_id,
        suggestion_type: "suggestion",
        campaign_id: null,
        discount_type: null,
        discount_value: null,
        discounted_price: null,
      });
    }
  }

  return suggestions.slice(0, 10);
};

module.exports = { getSuggestions };
