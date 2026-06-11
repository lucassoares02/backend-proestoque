const pool = require("../db");
const cartTracking = require("./cartTrackingService");

/**
 * Get All Orders
 */
const findAll = async (company_id, status) => {
  const isDraft = status == 0;
  const statusClause = isDraft
    ? `AND o.status = 'DRAFT'`
    : `AND o.status IN ('CONFIRMED', 'PENDING_SUPPLIER', 'APPROVED', 'REJECTED')`;
  const result = await pool.query(
    `
SELECT
  o.*,

  -- 🔹 dados do fornecedor
  s.razao_social AS supplier_razao_social,
  s.nome_fantasia AS supplier_nome_fantasia,
  s.logo AS supplier_logo,
  s.color AS supplier_color,

  -- 🔹 pedido mínimo do fornecedor
  ps.minimum_order_amount,

  COALESCE(
    json_agg(
      json_build_object(
        'id', oi.id,
        'order_id', oi.order_id,
        'product_id', oi.product_id,
        'package_id', oi.package_id,

        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'total_price', oi.total_price,

        'buy_together_campaign_id', oi.buy_together_campaign_id,
        'buy_together_applied', oi.buy_together_applied,

        -- 🔹 bonificação
        'is_bonus', COALESCE(oi.is_bonus, false),
        'bonus_rule_id', oi.bonus_rule_id,
        'bonus_rule_name', br.name,
        'bonus_rule_description', br.description,
        'bonus_original_unit_price', bpp.unit_price,

        -- 🔹 variação selecionada
        'variant_id', oi.variant_id,
        'variant_name', pv.name,

        -- 🔹 dados do produto no mesmo nível
        'name', p.name,
        'complement', p.complement,
        'brand', p.brand,
        'package_type', COALESCE(selpkg.package_title, p.package_type),
        'units_per_package', COALESCE(selpkg.package_units, p.units_per_package),

        -- 🔹 imagem: prefere da variação, senão a do produto
        'image', COALESCE(pv.image_url, pi.image_url)
      )
      ORDER BY oi.id
    ) FILTER (WHERE oi.id IS NOT NULL),
    '[]'
  ) AS items, o.public_id AS uuid
FROM orders o

-- 🔹 fornecedor
LEFT JOIN companies s
  ON s.id = o.supplier_id

-- 🔹 configurações de pagamento / pedido mínimo
LEFT JOIN payment_settings ps
  ON ps.supplier_id = o.supplier_id

LEFT JOIN order_items oi
  ON oi.order_id = o.id
LEFT JOIN products p
  ON p.id = oi.product_id
LEFT JOIN product_variants pv
  ON pv.id = oi.variant_id
LEFT JOIN bonus_rules br
  ON br.id = oi.bonus_rule_id

LEFT JOIN LATERAL (
  SELECT url AS image_url
  FROM products_images
  WHERE product_id = p.id
  ORDER BY id ASC
  LIMIT 1
) pi ON TRUE

LEFT JOIN LATERAL (
  SELECT pp.unit_price
  FROM products_prices pp
  LEFT JOIN products_packages ppk ON ppk.id = pp.product_package_id
  WHERE pp.product_id = oi.product_id
  ORDER BY
    (CASE WHEN ppk.package_id = oi.package_id THEN 0 ELSE 1 END),
    pp.qty_min ASC
  LIMIT 1
) bpp ON oi.is_bonus = true

-- 🔹 embalagem efetivamente comprada (resolve oi.package_id global)
LEFT JOIN LATERAL (
  SELECT pkg.title AS package_title, ppk.quantity AS package_units
  FROM products_packages ppk
  JOIN packages pkg ON pkg.id = ppk.package_id
  WHERE ppk.product_id = oi.product_id
    AND ppk.package_id = oi.package_id
  LIMIT 1
) selpkg ON oi.package_id IS NOT NULL

WHERE o.company_id = $1
${statusClause}
GROUP BY
  o.id,
  s.razao_social,
  s.nome_fantasia,
  s.logo,
  s.color,
  ps.minimum_order_amount
HAVING COUNT(oi.id) > 0
ORDER BY o.id DESC;





    `,
    [company_id]
  );

  return result.rows;
};

/**
 * Get All Order by Company
 */
const findOrder = async (company, supplier) => {
  // Retorna o(s) pedido(s) DRAFT do par company/supplier com os itens incluídos.
  // O BonusEngine do cliente depende do array de itens para casar regras de bonificação.
  const result = await pool.query(
    `
    SELECT
      o.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id',            oi.id,
            'order_id',      oi.order_id,
            'product_id',    oi.product_id,
            'package_id',    oi.package_id,
            'variant_id',    oi.variant_id,
            'quantity',      oi.quantity,
            'unit_price',    oi.unit_price,
            'total_price',   oi.total_price,
            'is_bonus',      COALESCE(oi.is_bonus, false),
            'bonus_rule_id', oi.bonus_rule_id
          )
          ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.company_id = $1
      AND o.supplier_id = $2
      AND o.status = 'DRAFT'
    GROUP BY o.id
    ORDER BY o.created_at DESC
    `,
    [company, supplier]
  );
  return result.rows;
};

const find = async (uuid) => {
  const result = await pool.query(
    `
    SELECT
      o.*,

      -- dados do fornecedor
      s.razao_social  AS supplier_razao_social,
      s.nome_fantasia AS supplier_nome_fantasia,
      s.logo          AS supplier_logo,
      s.color         AS supplier_color,

      -- pedido mínimo do fornecedor
      ps.minimum_order_amount,

      -- criador / aprovador (Part 5)
      u_creator.name  AS created_by_user_name,
      u_approver.name AS approved_by_user_name,

      COALESCE(
        json_agg(
          json_build_object(
            'id',               oi.id,
            'order_id',         oi.order_id,
            'product_id',       oi.product_id,
            'package_id',       oi.package_id,

            'quantity',         oi.quantity,
            'unit_price',       oi.unit_price,
            'total_price',      oi.total_price,

            -- variação selecionada (Part 1)
            'variant_id',       oi.variant_id,
            'variant_name',     pv.name,
            'variant_sku',      pv.sku,
            'variant_ean',      pv.ean,

            -- bonificação
            'is_bonus',         COALESCE(oi.is_bonus, false),
            'bonus_rule_id',    oi.bonus_rule_id,
            'bonus_rule_name',  br.name,
            'bonus_rule_description', br.description,
            'bonus_original_unit_price', bpp.unit_price,

            -- dados do produto
            'name',             p.name,
            'complement',       p.complement,
            'brand',            p.brand,
            'package_type',     COALESCE(selpkg.package_title, p.package_type),
            'units_per_package',COALESCE(selpkg.package_units, p.units_per_package),

            -- imagem: prefere variação, depois produto
            'image',            COALESCE(pv.image_url, pi.image_url),

            -- remoção parcial (Part 2)
            'is_removed',       COALESCE(oi.is_removed, false),
            'removed_reason',   oi.removed_reason,
            'removed_at',       oi.removed_at
          )
          ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items,

      o.public_id AS uuid

    FROM orders o

    LEFT JOIN companies s
      ON s.id = o.supplier_id

    LEFT JOIN payment_settings ps
      ON ps.supplier_id = o.supplier_id

    LEFT JOIN order_items oi
      ON oi.order_id = o.id
    LEFT JOIN products p
      ON p.id = oi.product_id
    LEFT JOIN product_variants pv
      ON pv.id = oi.variant_id
    LEFT JOIN bonus_rules br
      ON br.id = oi.bonus_rule_id

    LEFT JOIN LATERAL (
      SELECT url AS image_url
      FROM products_images
      WHERE product_id = p.id
      ORDER BY id ASC
      LIMIT 1
    ) pi ON TRUE

    LEFT JOIN LATERAL (
      SELECT pp.unit_price
      FROM products_prices pp
      LEFT JOIN products_packages ppk ON ppk.id = pp.product_package_id
      WHERE pp.product_id = oi.product_id
      ORDER BY
        (CASE WHEN ppk.package_id = oi.package_id THEN 0 ELSE 1 END),
        pp.qty_min ASC
      LIMIT 1
    ) bpp ON oi.is_bonus = true

    -- 🔹 embalagem efetivamente comprada (resolve oi.package_id global)
    LEFT JOIN LATERAL (
      SELECT pkg.title AS package_title, ppk.quantity AS package_units
      FROM products_packages ppk
      JOIN packages pkg ON pkg.id = ppk.package_id
      WHERE ppk.product_id = oi.product_id
        AND ppk.package_id = oi.package_id
      LIMIT 1
    ) selpkg ON oi.package_id IS NOT NULL

    LEFT JOIN users u_creator  ON u_creator.id  = o.created_by_user_id
    LEFT JOIN users u_approver ON u_approver.id = o.approved_by_user_id

    WHERE o.public_id = $1

    GROUP BY
      o.id,
      s.razao_social,
      s.nome_fantasia,
      s.logo,
      s.color,
      ps.minimum_order_amount,
      u_creator.name,
      u_approver.name

    HAVING COUNT(oi.id) > 0
    `,
    [uuid]
  );

  return result.rows[0] || null;
};

const _legacyPaymentInt = (method) => {
  if (method === "PIX") return 1;
  if (method === "BOLETO") return 2;
  if (method === "CREDITO_COMERCIAL") return 3;
  if (method === "TRANSFERENCIA_BANCARIA") return 4;
  return Number(method) || 0;
};

const create = async (uuid, payment_method, delivery_date, comment, boleto_term, created_by_user_id) => {
  const legacyInt = typeof payment_method === "string" ? _legacyPaymentInt(payment_method) : payment_method;
  const methodStr = typeof payment_method === "string" ? payment_method : null;

  const result = await pool.query(
    `UPDATE orders
     SET status = 'PENDING_SUPPLIER',
         payment = $2,
         payment_method = $3,
         boleto_term = $4,
         date = $5,
         notes = $6,
         created_by_user_id = $7
     WHERE public_id = $1
     RETURNING *`,
    [uuid, legacyInt, methodStr, boleto_term ?? null, delivery_date, comment, created_by_user_id ?? null],
  );

  // Jornada do Cliente: "Pedido enviado" — registrado no servidor para não
  // depender do frontend (que pode fechar a aba antes do evento ser enviado).
  const order = result.rows[0];
  if (order) {
    cartTracking.saveEvent({
      supplierId: order.supplier_id,
      buyerCompanyId: order.company_id,
      buyerUserId: created_by_user_id ?? null,
      orderId: order.id,
      eventType: "checkout_completed",
      stepName: "checkout",
      metadata: {
        payment_method: methodStr,
        boleto_term: boleto_term ?? null,
        delivery_date: delivery_date ?? null,
        total_value: order.total_value ?? null,
      },
    }).catch(() => {});
  }

  return result.rows[0];
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const { id, companyId, supplierId, status, totalValue, notes, expiresAt, createdAt, updatedAt } = data;
  const result = await pool.query(
    "UPDATE orders SET id = $1, company_id = $2, supplier_id = $3, status = $4, total_value = $5, notes = $6, expires_at = $7, created_at = $8, updated_at = $9 WHERE id = $10 RETURNING *",
    [id, companyId, supplierId, status, totalValue, notes, expiresAt, createdAt, updatedAt, id]
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM orders WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove, findOrder };
