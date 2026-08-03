const pool = require("../db");
const clientsService = require("./clientsService");

/**
 * Sugestões de compra criadas pelo fornecedor e direcionadas a clientes
 * específicos (`target_type = 'selected'`) ou a todos (`target_type = 'all'`).
 * Exclusão é sempre soft delete (`deleted_at`).
 */

const findAll = async (companyId) => {
  const result = await pool.query(
    `SELECT
       s.id,
       s.company_id,
       s.title,
       s.description,
       s.target_type,
       s.active,
       s.created_at,
       s.updated_at,
       COUNT(DISTINCT i.id)                               AS item_count,
       COALESCE(SUM(i.suggested_quantity), 0)             AS total_quantity,
       COUNT(DISTINCT cl.id)                              AS client_count
     FROM purchase_suggestions s
     LEFT JOIN purchase_suggestion_items   i  ON i.suggestion_id = s.id
     LEFT JOIN purchase_suggestion_clients cl ON cl.suggestion_id = s.id
     WHERE s.company_id = $1 AND s.deleted_at IS NULL
     GROUP BY s.id
     ORDER BY s.updated_at DESC, s.id DESC`,
    [companyId],
  );

  return result.rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    title: r.title,
    description: r.description,
    targetType: r.target_type,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    itemCount: parseInt(r.item_count) || 0,
    totalQuantity: parseInt(r.total_quantity) || 0,
    clientCount: parseInt(r.client_count) || 0,
  }));
};

const find = async (id) => {
  const head = await pool.query(
    `SELECT id, company_id, title, description, target_type, active, created_at, updated_at
     FROM purchase_suggestions
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!head.rows.length) return null;
  const s = head.rows[0];

  const items = await pool.query(
    `SELECT
       i.id,
       i.product_id,
       i.variant_id,
       i.product_package_id,
       i.suggested_quantity,
       p.name  AS product_name,
       p.sku   AS product_sku,
       b.name  AS brand_name,
       (SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS product_image
     FROM purchase_suggestion_items i
     LEFT JOIN products p ON p.id = i.product_id
     LEFT JOIN brands   b ON b.id = p.brand_id
     WHERE i.suggestion_id = $1
     ORDER BY i.id ASC`,
    [id],
  );

  const clients = await pool.query(
    `SELECT
       cl.company_id,
       c.nome_fantasia,
       c.razao_social
     FROM purchase_suggestion_clients cl
     LEFT JOIN companies c ON c.id = cl.company_id
     WHERE cl.suggestion_id = $1
     ORDER BY cl.id ASC`,
    [id],
  );

  return {
    id: s.id,
    companyId: s.company_id,
    title: s.title,
    description: s.description,
    targetType: s.target_type,
    active: s.active,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    items: items.rows.map((i) => ({
      id: i.id,
      productId: i.product_id,
      variantId: i.variant_id,
      productPackageId: i.product_package_id,
      suggestedQuantity: i.suggested_quantity,
      productName: i.product_name,
      productSku: i.product_sku,
      brandName: i.brand_name,
      productImage: i.product_image,
    })),
    clients: clients.rows.map((c) => ({
      companyId: c.company_id,
      name: c.nome_fantasia || c.razao_social || "Cliente",
    })),
  };
};

const getProducts = async (companyId) => {
  const result = await pool.query(
    `SELECT
       p.id,
       p.name,
       p.sku,
       b.name AS brand_name,
       (SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image
     FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.company_id = $1 AND p.active = true
     ORDER BY p.name`,
    [companyId],
  );
  return result.rows;
};

const getClients = async (companyId) => {
  const clients = await clientsService.listClients(companyId);
  // Formato enxuto para o seletor de direcionamento.
  return clients.map((c) => ({
    id: c.id,
    name: c.nomeFantasia || c.razaoSocial || "Cliente",
    cnpj: c.cnpj,
    isLead: c.isLead,
    isBuyer: c.isBuyer,
  }));
};

const _normalizeItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({
      productId: Number(it.productId ?? it.product_id),
      variantId: it.variantId ?? it.variant_id ?? null,
      productPackageId: it.productPackageId ?? it.product_package_id ?? null,
      suggestedQuantity: Math.max(1, parseInt(it.suggestedQuantity ?? it.suggested_quantity ?? 1) || 1),
    }))
    .filter((it) => it.productId && !Number.isNaN(it.productId));
};

const _insertChildren = async (client, suggestionId, items, targetType, clientIds) => {
  for (const it of items) {
    await client.query(
      `INSERT INTO purchase_suggestion_items
         (suggestion_id, product_id, variant_id, product_package_id, suggested_quantity, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [suggestionId, it.productId, it.variantId, it.productPackageId, it.suggestedQuantity],
    );
  }

  if (targetType === "selected" && Array.isArray(clientIds)) {
    const unique = [...new Set(clientIds.map(Number).filter(Boolean))];
    for (const cid of unique) {
      await client.query(
        `INSERT INTO purchase_suggestion_clients (suggestion_id, company_id, created_at)
         VALUES ($1, $2, NOW())`,
        [suggestionId, cid],
      );
    }
  }
};

const create = async (data) => {
  const { companyId, title, description, active } = data;
  const targetType = data.targetType === "selected" ? "selected" : "all";
  const items = _normalizeItems(data.items);
  const clientIds = data.clientIds || data.clients || [];

  if (!companyId) throw new Error("Fornecedor obrigatório");
  if (!title || !title.trim()) throw new Error("Título obrigatório");
  if (items.length === 0) throw new Error("Adicione ao menos um produto à sugestão");
  if (targetType === "selected" && (!Array.isArray(clientIds) || clientIds.length === 0)) {
    throw new Error("Selecione ao menos um cliente ou use 'Geral'");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO purchase_suggestions
         (company_id, title, description, target_type, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id`,
      [companyId, title.trim(), description?.trim() || null, targetType, active ?? true],
    );
    const suggestionId = inserted.rows[0].id;
    await _insertChildren(client, suggestionId, items, targetType, clientIds);
    await client.query("COMMIT");
    return await find(suggestionId);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const update = async (data) => {
  const { id, title, description, active } = data;
  const targetType = data.targetType === "selected" ? "selected" : "all";
  const items = _normalizeItems(data.items);
  const clientIds = data.clientIds || data.clients || [];

  if (!id) throw new Error("ID obrigatório");
  if (!title || !title.trim()) throw new Error("Título obrigatório");
  if (items.length === 0) throw new Error("Adicione ao menos um produto à sugestão");
  if (targetType === "selected" && (!Array.isArray(clientIds) || clientIds.length === 0)) {
    throw new Error("Selecione ao menos um cliente ou use 'Geral'");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT id FROM purchase_suggestions WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    if (!check.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `UPDATE purchase_suggestions
       SET title = $2, description = $3, target_type = $4, active = $5, updated_at = NOW()
       WHERE id = $1`,
      [id, title.trim(), description?.trim() || null, targetType, active ?? true],
    );

    // Substitui filhos (itens e clientes) por completo.
    await client.query(`DELETE FROM purchase_suggestion_items   WHERE suggestion_id = $1`, [id]);
    await client.query(`DELETE FROM purchase_suggestion_clients WHERE suggestion_id = $1`, [id]);
    await _insertChildren(client, id, items, targetType, clientIds);

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
    `UPDATE purchase_suggestions
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id],
  );
  return result.rows[0] || null;
};

module.exports = { findAll, find, getProducts, getClients, create, update, remove };
