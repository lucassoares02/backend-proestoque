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

// ─── Lado do cliente ──────────────────────────────────────────────────────────

/**
 * Sugestões ATIVAS visíveis para um cliente ao navegar no catálogo de um
 * fornecedor: `target_type = 'all'` (geral) ou direcionadas ao próprio cliente.
 */
const findForClient = async (supplierId, clientId) => {
  const sup = await pool.query(
    `SELECT nome_fantasia, razao_social, logo, color FROM companies WHERE id = $1`,
    [supplierId],
  );
  const supplier = sup.rows[0] || {};
  const supplierName = supplier.nome_fantasia || supplier.razao_social || "Fornecedor";

  const heads = await pool.query(
    `SELECT DISTINCT s.id, s.title, s.description, s.target_type, s.created_at, s.updated_at
       FROM purchase_suggestions s
       LEFT JOIN purchase_suggestion_clients cl ON cl.suggestion_id = s.id
      WHERE s.company_id = $1
        AND s.active = true
        AND s.deleted_at IS NULL
        AND (s.target_type = 'all' OR cl.company_id = $2)
      ORDER BY s.updated_at DESC, s.id DESC`,
    [supplierId, clientId],
  );

  const out = [];
  for (const s of heads.rows) {
    const items = await pool.query(
      `SELECT
         i.product_id,
         i.suggested_quantity,
         p.name  AS product_name,
         p.sku   AS product_sku,
         b.name  AS brand_name,
         (SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS product_image,
         (SELECT pp.unit_price
            FROM products_packages pk
            JOIN products_prices pp ON pp.product_package_id = pk.id
           WHERE pk.product_id = i.product_id
             AND pp.qty_min <= i.suggested_quantity
             AND (pp.qty_max IS NULL OR pp.qty_max >= i.suggested_quantity)
           ORDER BY pk.quantity ASC NULLS LAST, pp.qty_min DESC
           LIMIT 1) AS unit_price
       FROM purchase_suggestion_items i
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN brands   b ON b.id = p.brand_id
       WHERE i.suggestion_id = $1
       ORDER BY i.id ASC`,
      [s.id],
    );

    out.push({
      id: s.id,
      title: s.title,
      description: s.description,
      targetType: s.target_type,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      supplierId,
      supplierName,
      supplierLogo: supplier.logo || null,
      supplierColor: supplier.color || null,
      itemCount: items.rows.length,
      items: items.rows.map((i) => ({
        productId: i.product_id,
        suggestedQuantity: i.suggested_quantity,
        productName: i.product_name,
        productSku: i.product_sku,
        brandName: i.brand_name,
        productImage: i.product_image,
        unitPrice: i.unit_price != null ? Number(i.unit_price) : null,
      })),
    });
  }
  return out;
};

/**
 * Adiciona (incrementa — NÃO sobrescreve) os itens de uma sugestão ao carrinho
 * DRAFT do cliente com aquele fornecedor. Reusa a mesma lógica de preço/pacote
 * do restante do carrinho.
 */
const addToCart = async (suggestionId, buyerCompanyId, productIds = null) => {
  if (!buyerCompanyId) throw new Error("Cliente inválido");

  const sres = await pool.query(
    `SELECT id, company_id FROM purchase_suggestions
      WHERE id = $1 AND active = true AND deleted_at IS NULL`,
    [suggestionId],
  );
  if (!sres.rows.length) throw new Error("Sugestão indisponível");
  const supplierId = sres.rows[0].company_id;

  const itemsRes = await pool.query(
    `SELECT product_id, suggested_quantity
       FROM purchase_suggestion_items WHERE suggestion_id = $1`,
    [suggestionId],
  );
  if (itemsRes.rows.length === 0) throw new Error("Sugestão sem produtos");

  // Filtra pelos produtos selecionados pelo cliente (se informados).
  let rows = itemsRes.rows;
  if (Array.isArray(productIds) && productIds.length > 0) {
    const wanted = new Set(productIds.map(Number).filter(Boolean));
    rows = rows.filter((r) => wanted.has(Number(r.product_id)));
  }
  if (rows.length === 0) throw new Error("Nenhum item selecionado");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [buyerCompanyId, supplierId]);

    // Encontra ou cria o pedido DRAFT (carrinho) do cliente com o fornecedor.
    let orderId =
      (await client.query(
        `SELECT id FROM orders
          WHERE company_id = $1 AND supplier_id = $2 AND status = 'DRAFT'
          ORDER BY created_at DESC LIMIT 1`,
        [buyerCompanyId, supplierId],
      )).rows[0]?.id ?? null;

    if (!orderId) {
      orderId = (await client.query(
        `INSERT INTO orders (company_id, supplier_id, status, total_value)
         VALUES ($1, $2, 'DRAFT', 0) RETURNING id`,
        [buyerCompanyId, supplierId],
      )).rows[0].id;
    }

    let added = 0;
    const skipped = [];

    for (const it of rows) {
      const qty = Math.max(1, parseInt(it.suggested_quantity) || 1);

      // Resolve pacote-padrão + preço para a quantidade sugerida.
      const price = await client.query(
        `SELECT pk.package_id, pp.unit_price
           FROM products_packages pk
           JOIN products_prices pp ON pp.product_package_id = pk.id
          WHERE pk.product_id = $1
            AND pp.qty_min <= $2
            AND (pp.qty_max IS NULL OR pp.qty_max >= $2)
          ORDER BY pk.quantity ASC NULLS LAST, pp.qty_min DESC
          LIMIT 1`,
        [it.product_id, qty],
      );
      if (!price.rows.length) {
        skipped.push(it.product_id);
        continue;
      }
      const packageId = price.rows[0].package_id;
      const unitPrice = Number(price.rows[0].unit_price);

      // Incrementa se já existir a mesma chave (produto + pacote, não-bônus).
      const existing = await client.query(
        `SELECT id, quantity FROM order_items
          WHERE order_id = $1 AND product_id = $2
            AND package_id IS NOT DISTINCT FROM $3
            AND variant_id IS NULL
            AND COALESCE(is_bonus, false) = false
          LIMIT 1`,
        [orderId, it.product_id, packageId],
      );

      if (existing.rows.length) {
        const newQty = Number(existing.rows[0].quantity) + qty;
        await client.query(
          `UPDATE order_items SET quantity = $1, unit_price = $2, total_price = $3 WHERE id = $4`,
          [newQty, unitPrice, unitPrice * newQty, existing.rows[0].id],
        );
      } else {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, package_id, quantity, unit_price, total_price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, it.product_id, packageId, qty, unitPrice, unitPrice * qty],
        );
      }
      added++;
    }

    const totalRes = await client.query(
      `UPDATE orders
          SET total_value = (SELECT COALESCE(SUM(total_price), 0) FROM order_items WHERE order_id = $1),
              updated_at = NOW()
        WHERE id = $1
        RETURNING total_value`,
      [orderId],
    );

    await client.query("COMMIT");
    return {
      ok: true,
      orderId,
      added,
      skipped,
      total: Number(totalRes.rows[0].total_value),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

module.exports = {
  findAll,
  find,
  getProducts,
  getClients,
  create,
  update,
  remove,
  findForClient,
  addToCart,
};
