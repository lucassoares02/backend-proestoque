const pool = require("../db");

const SALE_STATUSES = ['CONFIRMED', 'PENDING_SUPPLIER', 'APPROVED'];

const _safe = async (label, fn, fallback) => {
  try {
    return await fn();
  } catch (e) {
    console.error(`[supplierDashboardService] ${label} failed:`, e.message);
    return fallback;
  }
};

const _getKpis = async (supplierId) => {
  const sql = `
    WITH
      t AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev, COUNT(*) AS cnt
        FROM orders
        WHERE supplier_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= CURRENT_DATE
      ),
      y AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev
        FROM orders
        WHERE supplier_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= (CURRENT_DATE - INTERVAL '1 day')
          AND created_at < CURRENT_DATE
      ),
      w AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev
        FROM orders
        WHERE supplier_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= date_trunc('week', CURRENT_TIMESTAMP)
      ),
      pw AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev
        FROM orders
        WHERE supplier_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= (date_trunc('week', CURRENT_TIMESTAMP) - INTERVAL '7 days')
          AND created_at <  date_trunc('week', CURRENT_TIMESTAMP)
      ),
      m AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev, COUNT(*) AS cnt
        FROM orders
        WHERE supplier_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
      ),
      pm AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev
        FROM orders
        WHERE supplier_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= date_trunc('month', (CURRENT_TIMESTAMP - INTERVAL '1 month'))
          AND created_at <  date_trunc('month', CURRENT_TIMESTAMP)
      ),
      pend AS (
        SELECT COUNT(*) AS cnt
        FROM orders
        WHERE supplier_id = $1
          AND status IN ('PENDING_SUPPLIER', 'CONFIRMED')
      ),
      prods AS (
        SELECT COUNT(*) AS cnt
        FROM products
        WHERE company_id = $1 AND active = true AND deleted_at IS NULL
      )
    SELECT
      t.rev   AS today_revenue,
      y.rev   AS yesterday_revenue,
      w.rev   AS week_revenue,
      pw.rev  AS prev_week_revenue,
      m.rev   AS month_revenue,
      m.cnt   AS month_orders,
      pm.rev  AS prev_month_revenue,
      pend.cnt  AS pending_orders,
      prods.cnt AS active_products,
      CASE WHEN m.cnt > 0 THEN ROUND(m.rev / m.cnt, 2) ELSE 0 END AS avg_ticket
    FROM t, y, w, pw, m, pm, pend, prods
  `;
  const { rows } = await pool.query(sql, [supplierId, SALE_STATUSES]);
  return rows[0] || _emptyKpis();
};

const _emptyKpis = () => ({
  today_revenue: 0, yesterday_revenue: 0,
  week_revenue: 0, prev_week_revenue: 0,
  month_revenue: 0, prev_month_revenue: 0,
  month_orders: 0, pending_orders: 0,
  active_products: 0, avg_ticket: 0,
});

const _getEvolutionDays = async (supplierId, daysBack) => {
  const sql = `
    WITH date_series AS (
      SELECT generate_series(
        CURRENT_DATE - ($2::int * INTERVAL '1 day'),
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS day
    ),
    daily AS (
      SELECT DATE(created_at) AS day,
             COALESCE(SUM(total_value), 0) AS revenue,
             COUNT(*) AS orders
      FROM orders
      WHERE supplier_id = $1
        AND status = ANY($3::varchar[])
        AND created_at >= (CURRENT_DATE - ($2::int * INTERVAL '1 day'))
      GROUP BY DATE(created_at)
    )
    SELECT ds.day::text AS date,
           COALESCE(d.revenue, 0) AS revenue,
           COALESCE(d.orders, 0) AS orders
    FROM date_series ds
    LEFT JOIN daily d ON d.day = ds.day
    ORDER BY ds.day ASC
  `;
  const { rows } = await pool.query(sql, [supplierId, daysBack, SALE_STATUSES]);
  return rows;
};

const _getEvolution12m = async (supplierId) => {
  const sql = `
    WITH month_series AS (
      SELECT generate_series(
        date_trunc('month', CURRENT_DATE) - INTERVAL '11 months',
        date_trunc('month', CURRENT_DATE),
        INTERVAL '1 month'
      )::date AS month
    ),
    monthly AS (
      SELECT date_trunc('month', created_at)::date AS month,
             COALESCE(SUM(total_value), 0) AS revenue,
             COUNT(*) AS orders
      FROM orders
      WHERE supplier_id = $1
        AND status = ANY($2::varchar[])
        AND created_at >= (date_trunc('month', CURRENT_DATE) - INTERVAL '11 months')
      GROUP BY date_trunc('month', created_at)
    )
    SELECT ms.month::text AS date,
           COALESCE(mo.revenue, 0) AS revenue,
           COALESCE(mo.orders, 0) AS orders
    FROM month_series ms
    LEFT JOIN monthly mo ON mo.month = ms.month
    ORDER BY ms.month ASC
  `;
  const { rows } = await pool.query(sql, [supplierId, SALE_STATUSES]);
  return rows;
};

const _getTopProducts = async (supplierId) => {
  const sql = `
    SELECT p.id AS product_id,
           p.name,
           COALESCE(SUM(oi.quantity), 0) AS quantity,
           COALESCE(SUM(oi.total_price), 0) AS revenue
    FROM products p
    JOIN order_items oi ON oi.product_id = p.id
    JOIN orders o ON o.id = oi.order_id
    WHERE p.company_id = $1
      AND o.status = ANY($2::varchar[])
      AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY p.id, p.name
    ORDER BY revenue DESC
    LIMIT 10
  `;
  const { rows } = await pool.query(sql, [supplierId, SALE_STATUSES]);
  return rows;
};

const _getTopClients = async (supplierId) => {
  const sql = `
    SELECT c.id AS company_id,
           COALESCE(NULLIF(c.nome_fantasia, ''), c.razao_social) AS name,
           COUNT(DISTINCT o.id) AS orders,
           COALESCE(SUM(o.total_value), 0) AS revenue
    FROM orders o
    JOIN companies c ON c.id = o.company_id
    WHERE o.supplier_id = $1
      AND o.status = ANY($2::varchar[])
      AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY c.id, c.nome_fantasia, c.razao_social
    ORDER BY revenue DESC
    LIMIT 10
  `;
  const { rows } = await pool.query(sql, [supplierId, SALE_STATUSES]);
  return rows;
};

const _getCategories = async (supplierId) => {
  const sql = `
    SELECT COALESCE(cat.name, 'Sem categoria') AS name,
           COALESCE(SUM(oi.total_price), 0) AS revenue,
           COALESCE(SUM(oi.quantity), 0) AS items_sold
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE o.supplier_id = $1
      AND o.status = ANY($2::varchar[])
      AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY cat.name
    ORDER BY revenue DESC
    LIMIT 8
  `;
  const { rows } = await pool.query(sql, [supplierId, SALE_STATUSES]);
  return rows;
};

const _getInsights = async (supplierId) => {
  const sql = `
    WITH no_sales AS (
      SELECT COUNT(*) AS cnt
      FROM products p
      WHERE p.company_id = $1
        AND p.active = true
        AND p.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id
            AND o.supplier_id = $1
            AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
            AND o.status = ANY($2::varchar[])
        )
    ),
    approval AS (
      SELECT
        COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
        COUNT(*) FILTER (WHERE status IN ('APPROVED', 'REJECTED')) AS total
      FROM orders
      WHERE supplier_id = $1
        AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
    )
    SELECT ns.cnt AS products_no_sales_30d,
           ap.approved AS approved_30d,
           ap.total AS reviewed_30d,
           CASE WHEN ap.total > 0
                THEN ROUND(ap.approved::numeric / ap.total * 100, 1)
                ELSE 0
           END AS approval_rate
    FROM no_sales ns, approval ap
  `;
  const { rows } = await pool.query(sql, [supplierId, SALE_STATUSES]);
  return rows[0] || _emptyInsights();
};

const _emptyInsights = () => ({
  products_no_sales_30d: 0,
  approved_30d: 0,
  reviewed_30d: 0,
  approval_rate: 0,
});

const getDashboard = async (supplierId) => {
  const [kpis, days7, days30, months12, topProducts, topClients, categories, insights] =
    await Promise.all([
      _safe('kpis', () => _getKpis(supplierId), _emptyKpis()),
      _safe('days7', () => _getEvolutionDays(supplierId, 6), []),
      _safe('days30', () => _getEvolutionDays(supplierId, 29), []),
      _safe('months12', () => _getEvolution12m(supplierId), []),
      _safe('topProducts', () => _getTopProducts(supplierId), []),
      _safe('topClients', () => _getTopClients(supplierId), []),
      _safe('categories', () => _getCategories(supplierId), []),
      _safe('insights', () => _getInsights(supplierId), _emptyInsights()),
    ]);

  return {
    kpis,
    evolution: { days7, days30, months12 },
    top_products: topProducts,
    top_clients: topClients,
    categories,
    insights,
  };
};

module.exports = { getDashboard };
