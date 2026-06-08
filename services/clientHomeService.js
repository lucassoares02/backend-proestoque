const pool = require("../db");

// Status de pedidos que contam como compra efetiva (não rascunho).
const BUY_STATUSES = ["CONFIRMED", "PENDING_SUPPLIER", "APPROVED"];

// Fragmento reutilizável para montar o "card" de um produto na Home.
const PRODUCT_CARD_FIELDS = `
  p.id AS product_id,
  p.name,
  p.company_id AS supplier_id,
  b.name  AS brand_name,
  b.color AS brand_color,
  (SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image,
  (SELECT MIN(pp.unit_price) FROM products_prices pp WHERE pp.product_id = p.id) AS start_price
`;

/** IDs dos fornecedores que atendem a cidade da empresa do cliente. */
const getAvailableSupplierIds = async (clientCompanyId) => {
  const result = await pool.query(
    `SELECT DISTINCT c.id
       FROM companies c
       JOIN routes r        ON r.company_id = c.id
       JOIN route_cities rc ON rc.route_id  = r.id
       JOIN companies c2    ON c2.codigo_municipio_ibge = rc.city_id
      WHERE c2.id = $1`,
    [clientCompanyId],
  );
  return result.rows.map((row) => row.id);
};

// ── Seção 1: Stories agregados por fornecedor ────────────────────────────────
const stories = async (clientCompanyId) => {
  const supplierIds = await getAvailableSupplierIds(clientCompanyId);
  if (supplierIds.length === 0) return [];
  const now = new Date().toISOString();

  const result = await pool.query(
    `SELECT s.id, s.company_id AS supplier_id, s.title, s.media_url, s.thumbnail_url,
            s.created_at, (sv.id IS NOT NULL) AS is_viewed,
            comp.nome_fantasia, comp.razao_social,
            comp.logo AS supplier_logo, comp.color AS supplier_color
       FROM supplier_stories s
       JOIN companies comp ON comp.id = s.company_id
       LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.company_id = $2
      WHERE s.company_id = ANY($1::int[])
        AND s.is_active = true
        AND (s.expires_at IS NULL OR s.expires_at > $3)
      ORDER BY is_viewed ASC, s.created_at DESC`,
    [supplierIds, clientCompanyId, now],
  );

  const groups = new Map();
  for (const row of result.rows) {
    if (!groups.has(row.supplier_id)) {
      groups.set(row.supplier_id, {
        supplier_id: row.supplier_id,
        supplier_name:
          row.nome_fantasia && row.nome_fantasia !== "" ? row.nome_fantasia : row.razao_social,
        supplier_logo: row.supplier_logo,
        supplier_color: row.supplier_color,
        new_count: 0,
        stories_count: 0,
        thumbnail: row.thumbnail_url || row.media_url,
      });
    }
    const g = groups.get(row.supplier_id);
    g.stories_count += 1;
    if (!row.is_viewed) g.new_count += 1;
  }

  // Fornecedores com novidades primeiro.
  return [...groups.values()].sort((a, b) => (b.new_count > 0) - (a.new_count > 0));
};

// ── Seção 2: Campanhas ativas (hero) ─────────────────────────────────────────
const campaigns = async (clientCompanyId) => {
  const supplierIds = await getAvailableSupplierIds(clientCompanyId);
  if (supplierIds.length === 0) return [];
  const now = new Date().toISOString();

  const result = await pool.query(
    `SELECT * FROM supplier_campaigns
      WHERE company_id = ANY($1::int[])
        AND is_active = true
        AND (start_at IS NULL OR start_at <= $2)
        AND (end_at   IS NULL OR end_at   >= $2)
      ORDER BY priority DESC, created_at DESC
      LIMIT 8`,
    [supplierIds, now],
  );
  return result.rows;
};

// ── Seção 3: Fornecedores em destaque ────────────────────────────────────────
const suppliers = async (clientCompanyId) => {
  const result = await pool.query(
    `SELECT c.id, c.razao_social, c.nome_fantasia, c.logo, c.color, c.municipio, c.uf,
            (SELECT COUNT(*) FROM products p
               WHERE p.company_id = c.id AND p.active = true) AS product_count,
            (SELECT COUNT(DISTINCT p.brand_id) FROM products p
               WHERE p.company_id = c.id AND p.active = true AND p.brand_id IS NOT NULL) AS brand_count,
            MAX(o.id) AS order_id
       FROM companies c
       JOIN routes r        ON r.company_id = c.id
       JOIN route_cities rc ON rc.route_id  = r.id
       JOIN companies c2    ON c2.codigo_municipio_ibge = rc.city_id
       LEFT JOIN orders o   ON o.supplier_id = c.id AND o.company_id = c2.id AND o.status = 'DRAFT'
      WHERE c2.id = $1
      GROUP BY c.id
      ORDER BY product_count DESC`,
    [clientCompanyId],
  );
  return result.rows;
};

// ── Seção 4: Marcas em destaque ──────────────────────────────────────────────
const brands = async (clientCompanyId) => {
  const supplierIds = await getAvailableSupplierIds(clientCompanyId);
  if (supplierIds.length === 0) return [];

  const result = await pool.query(
    `SELECT b.id, b.name, b.logo, b.icon_url, b.color, b.company_id AS supplier_id,
            (SELECT COUNT(*) FROM products p
               WHERE p.brand_id = b.id AND p.company_id = b.company_id AND p.active = true) AS product_count
       FROM brands b
      WHERE b.company_id = ANY($1::int[])
        AND b.active = true
      ORDER BY product_count DESC, b.name
      LIMIT 24`,
    [supplierIds],
  );
  return result.rows.filter((row) => Number(row.product_count) > 0);
};

// ── Seção 5: Produtos recomendados (ranking por prioridade) ──────────────────
const _candidateIds = async (clientCompanyId, supplierIds) => {
  const now = new Date().toISOString();
  const ordered = [];
  const push = (rows, key) => {
    for (const r of rows) {
      const id = r[key];
      if (id != null && !ordered.includes(id)) ordered.push(id);
    }
  };

  // 1) Mais comprados pelo cliente
  const mostBought = await pool.query(
    `SELECT oi.product_id, SUM(oi.quantity) AS qty
       FROM order_items oi
       JOIN orders o   ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
      WHERE o.company_id = $1 AND o.status = ANY($2::varchar[]) AND p.active = true
      GROUP BY oi.product_id
      ORDER BY qty DESC
      LIMIT 12`,
    [clientCompanyId, BUY_STATUSES],
  );
  push(mostBought.rows, "product_id");

  if (supplierIds.length > 0) {
    // 2) Alvos de campanhas ativas
    const camp = await pool.query(
      `SELECT target_id AS product_id FROM supplier_campaigns
        WHERE company_id = ANY($1::int[]) AND is_active = true AND target_type = 'product'
          AND (start_at IS NULL OR start_at <= $2) AND (end_at IS NULL OR end_at >= $2)
        ORDER BY priority DESC LIMIT 12`,
      [supplierIds, now],
    );
    push(camp.rows, "product_id");

    // 3) Alvos de stories ativos
    const st = await pool.query(
      `SELECT target_id AS product_id FROM supplier_stories
        WHERE company_id = ANY($1::int[]) AND is_active = true AND target_type = 'product'
          AND (expires_at IS NULL OR expires_at > $2) LIMIT 12`,
      [supplierIds, now],
    );
    push(st.rows, "product_id");

    // 4) Produtos de bonificação
    const bonus = await pool.query(
      `SELECT bonus_product_id AS product_id FROM bonus_rules
        WHERE company_id = ANY($1::int[]) AND is_active = true
          AND (starts_at IS NULL OR starts_at <= $2) AND (ends_at IS NULL OR ends_at >= $2) LIMIT 12`,
      [supplierIds, now],
    );
    push(bonus.rows, "product_id");

    // 5) Alvos de combo (buy together)
    const combo = await pool.query(
      `SELECT i.product_id FROM buy_together_campaign_items i
        JOIN buy_together_campaigns c ON c.id = i.campaign_id
       WHERE c.company_id = ANY($1::int[]) AND c.active = true AND i.role = 'target'
         AND c.starts_at <= $2 AND c.ends_at >= $2 LIMIT 12`,
      [supplierIds, now],
    );
    push(combo.rows, "product_id");
  }

  return ordered.slice(0, 12);
};

const _flagSets = async (supplierIds) => {
  if (supplierIds.length === 0) return { bonus: new Set(), combo: new Set() };
  const now = new Date().toISOString();
  const bonus = await pool.query(
    `SELECT bonus_product_id AS id FROM bonus_rules
      WHERE company_id = ANY($1::int[]) AND is_active = true
        AND (starts_at IS NULL OR starts_at <= $2) AND (ends_at IS NULL OR ends_at >= $2)`,
    [supplierIds, now],
  );
  const combo = await pool.query(
    `SELECT i.product_id AS id FROM buy_together_campaign_items i
       JOIN buy_together_campaigns c ON c.id = i.campaign_id
      WHERE c.company_id = ANY($1::int[]) AND c.active = true AND i.role = 'target'
        AND c.starts_at <= $2 AND c.ends_at >= $2`,
    [supplierIds, now],
  );
  return {
    bonus: new Set(bonus.rows.map((r) => r.id)),
    combo: new Set(combo.rows.map((r) => r.id)),
  };
};

const recommended = async (clientCompanyId) => {
  const supplierIds = await getAvailableSupplierIds(clientCompanyId);
  const ids = await _candidateIds(clientCompanyId, supplierIds);
  if (ids.length === 0) return [];

  const { bonus, combo } = await _flagSets(supplierIds);
  const result = await pool.query(
    `SELECT ${PRODUCT_CARD_FIELDS}
       FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.id = ANY($1::int[]) AND p.active = true`,
    [ids],
  );

  const byId = new Map(result.rows.map((r) => [r.product_id, r]));
  return ids
    .filter((id) => byId.has(id))
    .map((id) => {
      const r = byId.get(id);
      return { ...r, is_bonus: bonus.has(id), is_combo: combo.has(id) };
    });
};

// ── Seção (extra): Oportunidades do dia ──────────────────────────────────────
const opportunities = async (clientCompanyId) => {
  const supplierIds = await getAvailableSupplierIds(clientCompanyId);
  if (supplierIds.length === 0) return [];
  const now = new Date().toISOString();
  const items = [];

  const camp = await pool.query(
    `SELECT id, title, description, banner_image_url AS image, target_type, target_id, priority, company_id
       FROM supplier_campaigns
      WHERE company_id = ANY($1::int[]) AND is_active = true
        AND (start_at IS NULL OR start_at <= $2) AND (end_at IS NULL OR end_at >= $2)
      ORDER BY priority DESC, created_at DESC LIMIT 4`,
    [supplierIds, now],
  );
  for (const c of camp.rows) {
    items.push({
      kind: "campaign",
      tag: "🔥 Oferta Especial",
      title: c.title || "Campanha",
      subtitle: c.description,
      image: c.image,
      target_type: c.target_type,
      target_id: c.target_id,
      supplier_id: c.company_id,
    });
  }

  const bonus = await pool.query(
    `SELECT r.id, r.name, r.company_id, tp.name AS trigger_name, bp.name AS bonus_name, bp.id AS bonus_product_id
       FROM bonus_rules r
       LEFT JOIN products tp ON tp.id = r.trigger_product_id
       LEFT JOIN products bp ON bp.id = r.bonus_product_id
      WHERE r.company_id = ANY($1::int[]) AND r.is_active = true
        AND (r.starts_at IS NULL OR r.starts_at <= $2) AND (r.ends_at IS NULL OR r.ends_at >= $2)
      ORDER BY r.id DESC LIMIT 3`,
    [supplierIds, now],
  );
  for (const r of bonus.rows) {
    items.push({
      kind: "bonus",
      tag: "🎁 Bonificação",
      title: r.name || "Bonificação",
      subtitle: r.trigger_name ? `Compre ${r.trigger_name} e ganhe ${r.bonus_name || ""}`.trim() : null,
      image: null,
      target_type: "product",
      target_id: r.bonus_product_id,
      supplier_id: r.company_id,
    });
  }

  const combo = await pool.query(
    `SELECT c.id, c.name, c.company_id, tgt.product_id AS target_id, tp.name AS target_name
       FROM buy_together_campaigns c
       JOIN buy_together_campaign_items tgt ON tgt.campaign_id = c.id AND tgt.role = 'target'
       LEFT JOIN products tp ON tp.id = tgt.product_id
      WHERE c.company_id = ANY($1::int[]) AND c.active = true
        AND c.starts_at <= $2 AND c.ends_at >= $2
      ORDER BY c.id DESC LIMIT 3`,
    [supplierIds, now],
  );
  for (const c of combo.rows) {
    items.push({
      kind: "combo",
      tag: "⭐ Combo",
      title: c.name || "Oferta combinada",
      subtitle: c.target_name,
      image: null,
      target_type: "product",
      target_id: c.target_id,
      supplier_id: c.company_id,
    });
  }

  return items.slice(0, 8);
};

// ── Seção 7: Continuar comprando ─────────────────────────────────────────────
const recentlyPurchased = async (clientCompanyId) => {
  const result = await pool.query(
    `SELECT ${PRODUCT_CARD_FIELDS}, MAX(o.created_at) AS last_at
       FROM order_items oi
       JOIN orders o   ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE o.company_id = $1 AND o.status = ANY($2::varchar[]) AND p.active = true
      GROUP BY p.id, b.name, b.color
      ORDER BY last_at DESC
      LIMIT 12`,
    [clientCompanyId, BUY_STATUSES],
  );
  return result.rows;
};

const recentlyViewed = async (clientCompanyId) => {
  const result = await pool.query(
    `SELECT ${PRODUCT_CARD_FIELDS}, MAX(pv.created_at) AS last_at
       FROM product_views pv
       JOIN products p ON p.id = pv.product_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE pv.company_id = $1 AND p.active = true
      GROUP BY p.id, b.name, b.color
      ORDER BY last_at DESC
      LIMIT 12`,
    [clientCompanyId],
  );
  return result.rows;
};

module.exports = {
  getAvailableSupplierIds,
  stories,
  campaigns,
  suppliers,
  brands,
  recommended,
  opportunities,
  recentlyPurchased,
  recentlyViewed,
};
