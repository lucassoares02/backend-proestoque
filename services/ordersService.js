const pool = require("../db");

/**
 * Get All Orders
 */
const findAll = async (company_id, status) => {
  let statusText = status == 0 ? "DRAFT" : "CONFIRMED";
  const result = await pool.query(
    `
SELECT
  o.*,

  -- 🔹 dados do fornecedor
  s.razao_social AS supplier_razao_social,
  s.nome_fantasia AS supplier_nome_fantasia,
  s.logo AS supplier_logo,
  s.color AS supplier_color,

  COALESCE(
    json_agg(
      json_build_object(
        'id', oi.id,
        'order_id', oi.order_id,
        'product_id', oi.product_id,

        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'total_price', oi.total_price,

        -- 🔹 dados do produto no mesmo nível
        'name', p.name,
        'complement', p.complement,
        'brand', p.brand,
        'package_type', p.package_type,
        'units_per_package', p.units_per_package,

        -- 🔹 imagem do produto (primeira)
        'image', pi.image_url
      )
      ORDER BY oi.id
    ) FILTER (WHERE oi.id IS NOT NULL),
    '[]'
  ) AS items, o.public_id AS uuid
FROM orders o

-- 🔹 fornecedor
LEFT JOIN companies s
  ON s.id = o.supplier_id

LEFT JOIN order_items oi
  ON oi.order_id = o.id
LEFT JOIN products p
  ON p.id = oi.product_id

LEFT JOIN LATERAL (
  SELECT url AS image_url
  FROM products_images
  WHERE product_id = p.id
  ORDER BY id ASC
  LIMIT 1
) pi ON TRUE

WHERE o.company_id = $1
AND o.status = $2
GROUP BY
  o.id,
  s.razao_social,
  s.nome_fantasia,
  s.logo,
  s.color
HAVING COUNT(oi.id) > 0
ORDER BY o.id DESC;





    `,
    [company_id, statusText]
  );

  return result.rows;
};

/**
 * Get All Order by Company
 */
const findOrder = async (company, supplier) => {
  const result = await pool.query("select * from orders where company_id = $1 and supplier_id = $2", [company, supplier]);
  return result.rows;
};

const find = async (uuid) => {
  const result = await pool.query(
    `
    SELECT
      o.*,

      -- 🔹 dados do fornecedor
      s.razao_social AS supplier_razao_social,
      s.nome_fantasia AS supplier_nome_fantasia,
      s.logo AS supplier_logo,
      s.color AS supplier_color,

      COALESCE(
        json_agg(
          json_build_object(
            'id', oi.id,
            'order_id', oi.order_id,
            'product_id', oi.product_id,

            'quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'total_price', oi.total_price,

            -- 🔹 dados do produto no mesmo nível
            'name', p.name,
            'complement', p.complement,
            'brand', p.brand,
            'package_type', p.package_type,
            'units_per_package', p.units_per_package,

            -- 🔹 imagem do produto (primeira)
            'image', pi.image_url
          )
          ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items,

      o.public_id AS uuid

    FROM orders o

    -- 🔹 fornecedor
    LEFT JOIN companies s
      ON s.id = o.supplier_id

    LEFT JOIN order_items oi
      ON oi.order_id = o.id
    LEFT JOIN products p
      ON p.id = oi.product_id

    LEFT JOIN LATERAL (
      SELECT url AS image_url
      FROM products_images
      WHERE product_id = p.id
      ORDER BY id ASC
      LIMIT 1
    ) pi ON TRUE

    WHERE o.public_id = $1

    GROUP BY
      o.id,
      s.razao_social,
      s.nome_fantasia,
      s.logo,
      s.color

    HAVING COUNT(oi.id) > 0
    `,
    [uuid]
  );

  return result.rows[0] || null;
};

const create = async (uuid, payment_method, delivery_date, comment) => {
  const result = await pool.query("update orders set status = 'CONFIRMED', payment = $2, date = $3, notes = $4 where public_id = $1 RETURNING *", [
    uuid,
    payment_method,
    delivery_date,
    comment,
  ]);
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
