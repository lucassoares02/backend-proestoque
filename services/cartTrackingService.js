const pool = require("../db");
const { createNotification } = require("./notificationService");

const saveEvent = async ({
  supplierId,
  buyerCompanyId,
  buyerUserId = null,
  orderId = null,
  eventType,
  productId = null,
  variantId = null,
  quantity = null,
  stepName = null,
  metadata = {},
}) => {
  if (!supplierId || !buyerCompanyId || !eventType) return null;
  try {
    const result = await pool.query(
      `INSERT INTO cart_tracking_events
         (supplier_id, buyer_company_id, buyer_user_id, order_id, event_type,
          product_id, variant_id, quantity, step_name, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, uuid`,
      [
        supplierId, buyerCompanyId, buyerUserId, orderId, eventType,
        productId, variantId, quantity, stepName, JSON.stringify(metadata),
      ]
    );

    // Notify supplier on checkout abandonment
    if (eventType === "checkout_abandoned") {
      const orderInfo = await pool.query(
        `SELECT o.total_value, c.nome_fantasia, c.razao_social
         FROM cart_tracking_events cte
         LEFT JOIN orders o ON o.id = $1
         LEFT JOIN companies c ON c.id = $2
         LIMIT 1`,
        [orderId, buyerCompanyId]
      );
      const row = orderInfo.rows[0];
      const companyName = row?.nome_fantasia || row?.razao_social || "Cliente";
      const totalValue = row?.total_value
        ? `R$ ${parseFloat(row.total_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
        : "";
      await createNotification({
        companyId: supplierId,
        userType: 2,
        title: `Carrinho abandonado — ${companyName}`,
        description: totalValue
          ? `${companyName} abandonou um carrinho de ${totalValue} em "${stepName || "checkout"}"`
          : `${companyName} abandonou o checkout`,
        notificationType: "order",
        entityType: "order",
        entityId: orderId,
      });
    }

    return result.rows[0];
  } catch (e) {
    console.error("[cartTrackingService] saveEvent error:", e.message);
    return null;
  }
};

const getSessions = async (supplierId, { period = 30, page = 1, limit = 20, buyerCompanyId = null } = {}) => {
  const offset = (page - 1) * limit;
  const periodDays = parseInt(period) || 30;

  const params = [supplierId, periodDays, limit, offset];
  let buyerFilter = "";
  if (buyerCompanyId) {
    params.push(buyerCompanyId);
    buyerFilter = `AND cte.buyer_company_id = $${params.length}`;
  }

  const sql = `
    WITH last_events AS (
      SELECT DISTINCT ON (cte.buyer_company_id, cte.order_id)
        cte.buyer_company_id,
        cte.order_id,
        cte.event_type          AS last_event_type,
        cte.step_name           AS last_step,
        cte.created_at          AS last_activity,
        c_buyer.nome_fantasia   AS buyer_fantasia,
        c_buyer.razao_social    AS buyer_razao
      FROM cart_tracking_events cte
      LEFT JOIN companies c_buyer ON c_buyer.id = cte.buyer_company_id
      WHERE cte.supplier_id = $1
        AND cte.created_at >= NOW() - ($2 || ' days')::INTERVAL
        ${buyerFilter}
      ORDER BY cte.buyer_company_id, cte.order_id, cte.created_at DESC
    ),
    sessions AS (
      SELECT
        le.buyer_company_id,
        le.order_id,
        le.last_event_type,
        le.last_step,
        le.last_activity,
        le.buyer_fantasia,
        le.buyer_razao,
        COUNT(DISTINCT cte2.id)                      AS event_count,
        COUNT(DISTINCT cte2.product_id)              AS product_count,
        SUM(DISTINCT o.total_value::NUMERIC)         AS potential_value,
        COUNT(*) FILTER (WHERE cte2.event_type = 'checkout_abandoned') AS abandoned_count
      FROM last_events le
      LEFT JOIN cart_tracking_events cte2
             ON cte2.buyer_company_id = le.buyer_company_id
            AND cte2.order_id         = le.order_id
            AND cte2.supplier_id      = $1
      LEFT JOIN orders o ON o.id = le.order_id
      GROUP BY le.buyer_company_id, le.order_id, le.last_event_type, le.last_step,
               le.last_activity, le.buyer_fantasia, le.buyer_razao
    )
    SELECT *, COUNT(*) OVER () AS total_count
    FROM sessions
    ORDER BY last_activity DESC
    LIMIT $3 OFFSET $4
  `;

  const result = await pool.query(sql, params);
  const total = result.rows[0]?.total_count ?? 0;
  return {
    data: result.rows.map(r => ({
      buyerCompanyId: r.buyer_company_id,
      orderId: r.order_id,
      buyerName: r.buyer_fantasia || r.buyer_razao || "—",
      lastEventType: r.last_event_type,
      lastStep: r.last_step,
      lastActivity: r.last_activity,
      eventCount: parseInt(r.event_count),
      productCount: parseInt(r.product_count),
      potentialValue: r.potential_value ? parseFloat(r.potential_value) : null,
      isAbandoned: r.abandoned_count > 0,
    })),
    total: parseInt(total),
    page,
    limit,
  };
};

const getSessionTimeline = async (supplierId, orderId) => {
  const result = await pool.query(
    `SELECT
       cte.id,
       cte.event_type,
       cte.step_name,
       cte.product_id,
       cte.variant_id,
       cte.quantity,
       cte.metadata,
       cte.created_at,
       p.name                                                                          AS product_name,
       COALESCE(pv.image_url,
         (SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1)
       )                                                                               AS product_image,
       p.package_type,
       p.units_per_package,
       pv.name                                                                         AS variant_name,
       pv.sku                                                                          AS variant_sku,
       oi.unit_price,
       oi.total_price
     FROM cart_tracking_events cte
     LEFT JOIN products p        ON p.id  = cte.product_id
     LEFT JOIN product_variants pv ON pv.id = cte.variant_id
     LEFT JOIN order_items oi
       ON oi.order_id   = cte.order_id
      AND oi.product_id = cte.product_id
      AND oi.variant_id IS NOT DISTINCT FROM cte.variant_id
     WHERE cte.supplier_id = $1 AND cte.order_id = $2
     ORDER BY cte.created_at ASC`,
    [supplierId, orderId]
  );
  return result.rows;
};

const getSessionSummary = async (supplierId, orderId) => {
  const result = await pool.query(
    `SELECT
       o.total_value,
       o.status,
       o.payment_method,
       o.boleto_term,
       o.date                                                                          AS delivery_date,
       o.created_at                                                                    AS order_created,
       COALESCE(c.nome_fantasia, c.razao_social)                                       AS buyer_name,
       c.municipio                                                                     AS buyer_municipio,
       c.uf                                                                            AS buyer_uf,
       c.ddd_telefone_1                                                                AS buyer_phone,
       COUNT(cte.id)::int                                                              AS event_count,
       MIN(cte.created_at)                                                             AS first_event,
       MAX(cte.created_at)                                                             AS last_event,
       (COUNT(*) FILTER (WHERE cte.event_type = 'checkout_abandoned'))::int            AS abandoned_count,
       (COUNT(*) FILTER (WHERE cte.event_type = 'checkout_completed'))::int            AS completed_count,
       COUNT(DISTINCT CASE WHEN cte.event_type = 'product_added' THEN cte.product_id END)::int AS product_count,
       MAX(CASE WHEN cte.event_type = 'checkout_abandoned' THEN cte.step_name END)    AS abandoned_step
     FROM orders o
     JOIN companies c ON c.id = o.company_id
     LEFT JOIN cart_tracking_events cte
       ON cte.order_id = o.id AND cte.supplier_id = $1
     WHERE o.id = $2
     GROUP BY o.id, c.id`,
    [supplierId, orderId]
  );

  if (!result.rows[0]) return null;
  const r = result.rows[0];

  const itemsResult = await pool.query(
    `SELECT
       oi.product_id,
       oi.variant_id,
       oi.quantity,
       oi.unit_price,
       oi.total_price,
       p.name                                                                             AS product_name,
       p.package_type,
       p.units_per_package,
       pv.name                                                                            AS variant_name,
       pv.sku                                                                             AS variant_sku,
       COALESCE(pv.image_url, (
         SELECT pi.url FROM products_images pi
         WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1
       ))                                                                                 AS product_image
     FROM order_items oi
     JOIN products p        ON p.id  = oi.product_id
     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
     WHERE oi.order_id = $1
     ORDER BY oi.id ASC`,
    [orderId]
  );

  return {
    totalValue:      r.total_value  ? parseFloat(r.total_value)  : null,
    status:          r.status,
    paymentMethod:   r.payment_method,
    boletoTerm:      r.boleto_term  ? parseInt(r.boleto_term)   : null,
    deliveryDate:    r.delivery_date,
    orderCreated:    r.order_created,
    buyerName:       r.buyer_name,
    buyerMunicipio:  r.buyer_municipio,
    buyerUf:         r.buyer_uf,
    buyerPhone:      r.buyer_phone,
    eventCount:      r.event_count,
    firstEvent:      r.first_event,
    lastEvent:       r.last_event,
    abandonedCount:  r.abandoned_count,
    completedCount:  r.completed_count,
    productCount:    r.product_count,
    abandonedStep:   r.abandoned_step,
    isAbandoned:     r.abandoned_count > 0,
    isCompleted:     r.completed_count > 0,
    orderItems:      itemsResult.rows.map(i => ({
      productId:       i.product_id,
      variantId:       i.variant_id,
      quantity:        i.quantity,
      unitPrice:       i.unit_price  ? parseFloat(i.unit_price)  : null,
      totalPrice:      i.total_price ? parseFloat(i.total_price) : null,
      productName:     i.product_name,
      variantName:     i.variant_name,
      variantSku:      i.variant_sku,
      productImage:    i.product_image,
      packageType:     i.package_type,
      unitsPerPackage: i.units_per_package,
    })),
  };
};

const getMetrics = async (supplierId, { period = 30 } = {}) => {
  const periodDays = parseInt(period) || 30;

  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'checkout_abandoned') AS abandoned_count,
       COUNT(*) FILTER (WHERE event_type = 'checkout_completed') AS completed_count,
       COUNT(*) FILTER (WHERE event_type = 'checkout_started')   AS started_count,
       COUNT(DISTINCT CASE WHEN event_type = 'checkout_abandoned' THEN order_id END) AS abandoned_orders,
       COUNT(DISTINCT CASE WHEN event_type = 'checkout_completed' THEN order_id END) AS completed_orders,
       COUNT(DISTINCT CASE WHEN event_type IN ('product_added','cart_created') THEN order_id END) AS total_sessions
     FROM cart_tracking_events
     WHERE supplier_id = $1
       AND created_at >= NOW() - ($2 || ' days')::INTERVAL`,
    [supplierId, periodDays]
  );

  const topAbandoned = await pool.query(
    `SELECT
       cte.product_id,
       p.name AS product_name,
       (SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS product_image,
       COUNT(*) AS abandonment_count
     FROM cart_tracking_events cte
     JOIN products p ON p.id = cte.product_id
     WHERE cte.supplier_id = $1
       AND cte.event_type = 'checkout_abandoned'
       AND cte.product_id IS NOT NULL
       AND cte.created_at >= NOW() - ($2 || ' days')::INTERVAL
     GROUP BY cte.product_id, p.name, p.id
     ORDER BY abandonment_count DESC
     LIMIT 5`,
    [supplierId, periodDays]
  );

  const funnelSteps = await pool.query(
    `SELECT event_type, COUNT(DISTINCT order_id) AS count
     FROM cart_tracking_events
     WHERE supplier_id = $1
       AND event_type IN ('product_added','checkout_started','payment_selected','checkout_completed')
       AND created_at >= NOW() - ($2 || ' days')::INTERVAL
     GROUP BY event_type`,
    [supplierId, periodDays]
  );

  const stepAbandonment = await pool.query(
    `SELECT step_name, COUNT(*) AS count
     FROM cart_tracking_events
     WHERE supplier_id = $1
       AND event_type = 'checkout_abandoned'
       AND step_name IS NOT NULL
       AND created_at >= NOW() - ($2 || ' days')::INTERVAL
     GROUP BY step_name
     ORDER BY count DESC`,
    [supplierId, periodDays]
  );

  const row = result.rows[0];
  const abandoned = parseInt(row.abandoned_orders) || 0;
  const completed = parseInt(row.completed_orders) || 0;
  const started = parseInt(row.started_count) || 0;
  const total = abandoned + completed;
  const conversionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const funnelMap = {};
  funnelSteps.rows.forEach(r => { funnelMap[r.event_type] = parseInt(r.count); });

  return {
    abandonedOrders: abandoned,
    completedOrders: completed,
    conversionRate,
    totalSessions: parseInt(row.total_sessions) || 0,
    topAbandonedProducts: topAbandoned.rows.map(r => ({
      productId: r.product_id,
      productName: r.product_name,
      productImage: r.product_image,
      count: parseInt(r.abandonment_count),
    })),
    stepAbandonment: stepAbandonment.rows.map(r => ({
      step: r.step_name,
      count: parseInt(r.count),
    })),
    funnel: [
      { step: "Produto adicionado", key: "product_added", count: funnelMap["product_added"] || 0 },
      { step: "Checkout iniciado", key: "checkout_started", count: funnelMap["checkout_started"] || 0 },
      { step: "Pagamento selecionado", key: "payment_selected", count: funnelMap["payment_selected"] || 0 },
      { step: "Pedido concluído", key: "checkout_completed", count: funnelMap["checkout_completed"] || 0 },
    ],
  };
};

module.exports = { saveEvent, getSessions, getSessionTimeline, getSessionSummary, getMetrics };
