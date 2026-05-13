const pool = require("../db");

const BUY_STATUSES = ['CONFIRMED', 'PENDING_SUPPLIER', 'APPROVED'];

const _safe = async (label, fn, fallback) => {
  try {
    return await fn();
  } catch (e) {
    console.error(`[buyerDashboardService] ${label} failed:`, e.message);
    return fallback;
  }
};

const _emptyKpis = () => ({
  today_revenue: 0, yesterday_revenue: 0,
  week_revenue: 0, prev_week_revenue: 0,
  month_revenue: 0, prev_month_revenue: 0,
  month_orders: 0, total_orders_30d: 0,
  suppliers_count: 0, savings_30d: 0,
  avg_ticket: 0,
});

const _emptyInsights = () => ({
  recurring_count: 0,
  purchase_frequency: 0,
  last_order_days_ago: null,
  most_bought_product: null,
});

const _getKpis = async (companyId) => {
  const sql = `
    WITH
      t AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev, COUNT(*) AS cnt
        FROM orders
        WHERE company_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= CURRENT_DATE
      ),
      y AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev
        FROM orders
        WHERE company_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= (CURRENT_DATE - INTERVAL '1 day')
          AND created_at < CURRENT_DATE
      ),
      w AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev
        FROM orders
        WHERE company_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= date_trunc('week', CURRENT_TIMESTAMP)
      ),
      pw AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev
        FROM orders
        WHERE company_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= (date_trunc('week', CURRENT_TIMESTAMP) - INTERVAL '7 days')
          AND created_at <  date_trunc('week', CURRENT_TIMESTAMP)
      ),
      m AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev, COUNT(*) AS cnt
        FROM orders
        WHERE company_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
      ),
      pm AS (
        SELECT COALESCE(SUM(total_value), 0) AS rev
        FROM orders
        WHERE company_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= date_trunc('month', (CURRENT_TIMESTAMP - INTERVAL '1 month'))
          AND created_at <  date_trunc('month', CURRENT_TIMESTAMP)
      ),
      total30 AS (
        SELECT COUNT(*) AS cnt
        FROM orders
        WHERE company_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
      ),
      sup AS (
        SELECT COUNT(DISTINCT supplier_id) AS cnt
        FROM orders
        WHERE company_id = $1
          AND status = ANY($2::varchar[])
          AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
      ),
      sav AS (
        SELECT COALESCE(SUM(GREATEST((tabela.unit_price - oi.unit_price) * oi.quantity, 0)), 0) AS total
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN LATERAL (
          SELECT pp.unit_price
          FROM products_prices pp
          WHERE pp.product_id = oi.product_id
          ORDER BY pp.qty_min ASC
          LIMIT 1
        ) tabela ON true
        WHERE o.company_id = $1
          AND o.status = ANY($2::varchar[])
          AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
      )
    SELECT
      t.rev   AS today_revenue,
      y.rev   AS yesterday_revenue,
      w.rev   AS week_revenue,
      pw.rev  AS prev_week_revenue,
      m.rev   AS month_revenue,
      m.cnt   AS month_orders,
      pm.rev  AS prev_month_revenue,
      total30.cnt AS total_orders_30d,
      sup.cnt AS suppliers_count,
      sav.total AS savings_30d,
      CASE WHEN m.cnt > 0 THEN ROUND(m.rev / m.cnt, 2) ELSE 0 END AS avg_ticket
    FROM t, y, w, pw, m, pm, total30, sup, sav
  `;
  const { rows } = await pool.query(sql, [companyId, BUY_STATUSES]);
  return rows[0] || _emptyKpis();
};

const _getEvolutionDays = async (companyId, daysBack) => {
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
      WHERE company_id = $1
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
  const { rows } = await pool.query(sql, [companyId, daysBack, BUY_STATUSES]);
  return rows;
};

const _getEvolution12m = async (companyId) => {
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
      WHERE company_id = $1
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
  const { rows } = await pool.query(sql, [companyId, BUY_STATUSES]);
  return rows;
};

const _getTopProducts = async (companyId) => {
  const sql = `
    SELECT p.id AS product_id,
           p.name,
           COALESCE(SUM(oi.quantity), 0) AS quantity,
           COALESCE(SUM(oi.total_price), 0) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.company_id = $1
      AND o.status = ANY($2::varchar[])
      AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY p.id, p.name
    ORDER BY revenue DESC
    LIMIT 10
  `;
  const { rows } = await pool.query(sql, [companyId, BUY_STATUSES]);
  return rows;
};

const _getTopSuppliers = async (companyId) => {
  const sql = `
    SELECT c.id AS company_id,
           COALESCE(NULLIF(c.nome_fantasia, ''), c.razao_social) AS name,
           COUNT(DISTINCT o.id) AS orders,
           COALESCE(SUM(o.total_value), 0) AS revenue
    FROM orders o
    JOIN companies c ON c.id = o.supplier_id
    WHERE o.company_id = $1
      AND o.status = ANY($2::varchar[])
      AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY c.id, c.nome_fantasia, c.razao_social
    ORDER BY revenue DESC
    LIMIT 10
  `;
  const { rows } = await pool.query(sql, [companyId, BUY_STATUSES]);
  return rows;
};

const _getCategories = async (companyId) => {
  const sql = `
    SELECT COALESCE(cat.name, 'Sem categoria') AS name,
           COALESCE(SUM(oi.total_price), 0) AS revenue,
           COALESCE(SUM(oi.quantity), 0) AS items_sold
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN products_categories cat ON cat.id = p.category_id
    WHERE o.company_id = $1
      AND o.status = ANY($2::varchar[])
      AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY cat.name
    ORDER BY revenue DESC
    LIMIT 8
  `;
  const { rows } = await pool.query(sql, [companyId, BUY_STATUSES]);
  return rows;
};

const _getRecentOrders = async (companyId) => {
  const sql = `
    SELECT o.id,
           o.public_id AS uuid,
           o.total_value,
           o.status,
           o.created_at,
           COALESCE(NULLIF(c.nome_fantasia, ''), c.razao_social) AS supplier_name,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o
    JOIN companies c ON c.id = o.supplier_id
    WHERE o.company_id = $1
      AND o.status = ANY($2::varchar[])
    ORDER BY o.created_at DESC
    LIMIT 8
  `;
  const { rows } = await pool.query(sql, [companyId, BUY_STATUSES]);
  return rows;
};

const _getInsights = async (companyId) => {
  const sql = `
    WITH last_order AS (
      SELECT MAX(created_at) AS last_at
      FROM orders
      WHERE company_id = $1
        AND status = ANY($2::varchar[])
    ),
    counts AS (
      SELECT COUNT(*) AS total_30d
      FROM orders
      WHERE company_id = $1
        AND status = ANY($2::varchar[])
        AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
    ),
    most_bought AS (
      SELECT p.name, SUM(oi.quantity) AS qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      WHERE o.company_id = $1
        AND o.status = ANY($2::varchar[])
        AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
      GROUP BY p.name
      ORDER BY qty DESC
      LIMIT 1
    )
    SELECT
      CASE WHEN lo.last_at IS NULL
           THEN NULL
           ELSE EXTRACT(DAY FROM (CURRENT_TIMESTAMP - lo.last_at))::int
      END AS last_order_days_ago,
      counts.total_30d,
      CASE WHEN counts.total_30d > 0
           THEN ROUND(30.0 / counts.total_30d, 1)
           ELSE 0
      END AS purchase_frequency,
      (SELECT name FROM most_bought) AS most_bought_product
    FROM last_order lo, counts
  `;
  const { rows } = await pool.query(sql, [companyId, BUY_STATUSES]);
  const r = rows[0] || {};
  return {
    last_order_days_ago: r.last_order_days_ago,
    purchase_frequency: Number(r.purchase_frequency) || 0,
    most_bought_product: r.most_bought_product,
    recurring_count: 0,
  };
};

const getDashboard = async (companyId) => {
  const [kpis, days7, days30, months12, topProducts, topSuppliers, categories, recentOrders, insights] =
    await Promise.all([
      _safe('kpis', () => _getKpis(companyId), _emptyKpis()),
      _safe('days7', () => _getEvolutionDays(companyId, 6), []),
      _safe('days30', () => _getEvolutionDays(companyId, 29), []),
      _safe('months12', () => _getEvolution12m(companyId), []),
      _safe('topProducts', () => _getTopProducts(companyId), []),
      _safe('topSuppliers', () => _getTopSuppliers(companyId), []),
      _safe('categories', () => _getCategories(companyId), []),
      _safe('recentOrders', () => _getRecentOrders(companyId), []),
      _safe('insights', () => _getInsights(companyId), _emptyInsights()),
    ]);

  return {
    kpis,
    evolution: { days7, days30, months12 },
    top_products: topProducts,
    top_suppliers: topSuppliers,
    categories,
    recent_orders: recentOrders,
    insights,
  };
};

module.exports = { getDashboard };
