const pool = require("../db");

const getSalesHistory = async (productId, period) => {
  let dateClause = "";
  if (period === "today") {
    dateClause = `AND o.created_at >= CURRENT_DATE`;
  } else if (period === "7d") {
    dateClause = `AND o.created_at >= NOW() - INTERVAL '7 days'`;
  } else if (period === "30d") {
    dateClause = `AND o.created_at >= NOW() - INTERVAL '30 days'`;
  } else if (period === "90d") {
    dateClause = `AND o.created_at >= NOW() - INTERVAL '90 days'`;
  }

  const salesResult = await pool.query(
    `SELECT
       o.id              AS order_id,
       o.public_id       AS order_uuid,
       c.razao_social    AS buyer_name,
       c.nome_fantasia   AS buyer_company,
       oi.variant_id,
       pv.name           AS variant_name,
       oi.quantity,
       oi.unit_price,
       oi.total_price,
       o.status,
       o.created_at
     FROM order_items oi
     JOIN orders o            ON o.id  = oi.order_id
     JOIN companies c         ON c.id  = o.company_id
     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
     WHERE oi.product_id = $1
       AND o.status = 'APPROVED'
       ${dateClause}
     ORDER BY o.created_at DESC`,
    [productId],
  );

  const kpiResult = await pool.query(
    `SELECT
       COALESCE(SUM(oi.quantity), 0)         AS total_units,
       COALESCE(SUM(oi.total_price), 0)      AS total_revenue,
       MAX(o.created_at)                     AS last_sale,
       COUNT(DISTINCT o.company_id)          AS unique_buyers
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = $1
       AND o.status = 'APPROVED'
       ${dateClause}`,
    [productId],
  );

  return {
    sales: salesResult.rows,
    kpis: kpiResult.rows[0],
  };
};

module.exports = { getSalesHistory };
