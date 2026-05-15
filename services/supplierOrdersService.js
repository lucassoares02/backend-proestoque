const pool = require("../db");
const notificationService = require("./notificationService");

const findAll = async (supplierId, statusFilter) => {
  let statusClause;
  if (statusFilter === "pending") {
    statusClause = `AND o.status IN ('PENDING_SUPPLIER', 'CONFIRMED')`;
  } else if (statusFilter === "approved") {
    statusClause = `AND o.status = 'APPROVED'`;
  } else if (statusFilter === "rejected") {
    statusClause = `AND o.status = 'REJECTED'`;
  } else {
    statusClause = `AND o.status IN ('PENDING_SUPPLIER', 'CONFIRMED', 'APPROVED', 'REJECTED')`;
  }

  const result = await pool.query(
    `SELECT
       o.id,
       o.public_id         AS uuid,
       o.company_id,
       o.supplier_id,
       o.status,
       o.total_value,
       o.notes,
       o.payment,
       o.date,
       o.supplier_comment,
       o.supplier_reviewed_at,
       o.created_at,
       o.updated_at,
       c.razao_social      AS company_razao_social,
       c.nome_fantasia     AS company_nome_fantasia,
       COUNT(oi.id)        AS item_count
     FROM orders o
     LEFT JOIN companies c  ON c.id = o.company_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.supplier_id = $1
     ${statusClause}
     GROUP BY o.id, c.razao_social, c.nome_fantasia
     HAVING COUNT(oi.id) > 0
     ORDER BY o.id DESC`,
    [supplierId],
  );

  return result.rows;
};

const find = async (uuid, supplierId) => {
  const result = await pool.query(
    `SELECT
       o.*,
       -- client company
       c.razao_social    AS company_razao_social,
       c.nome_fantasia   AS company_nome_fantasia,
       c.cnpj            AS company_cnpj,
       c.email           AS company_email,
       c.ddd_telefone1   AS company_phone,
       c.logradouro      AS company_logradouro,
       c.numero          AS company_numero,
       c.complemento     AS company_complemento,
       c.bairro          AS company_bairro,
       c.municipio       AS company_municipio,
       c.uf              AS company_uf,
       c.cep             AS company_cep,
       -- delivery route
       r.name            AS route_name,
       -- items
       COALESCE(
         json_agg(
           json_build_object(
             'id',               oi.id,
             'order_id',         oi.order_id,
             'product_id',       oi.product_id,
             'quantity',         oi.quantity,
             'unit_price',       oi.unit_price,
             'total_price',      oi.total_price,
             'name',             p.name,
             'complement',       p.complement,
             'brand',            p.brand,
             'package_type',     p.package_type,
             'units_per_package',p.units_per_package,
             'image',            pi.image_url
           )
           ORDER BY oi.id
         ) FILTER (WHERE oi.id IS NOT NULL),
         '[]'
       ) AS items,
       o.public_id AS uuid
     FROM orders o
     LEFT JOIN companies c     ON c.id = o.company_id
     LEFT JOIN routes r        ON r.id = o.route_date
     LEFT JOIN order_items oi  ON oi.order_id = o.id
     LEFT JOIN products p      ON p.id = oi.product_id
     LEFT JOIN LATERAL (
       SELECT url AS image_url FROM products_images
       WHERE product_id = p.id ORDER BY id ASC LIMIT 1
     ) pi ON TRUE
     WHERE o.public_id = $1
       AND o.supplier_id = $2
     GROUP BY o.id,
              c.razao_social, c.nome_fantasia, c.cnpj, c.email,
              c.ddd_telefone1, c.logradouro, c.numero, c.complemento,
              c.bairro, c.municipio, c.uf, c.cep,
              r.name`,
    [uuid, supplierId],
  );

  return result.rows[0] || null;
};

const review = async (uuid, supplierId, action, comment) => {
  const newStatus = action === "approve" ? "APPROVED" : "REJECTED";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT id, status FROM orders WHERE public_id = $1 AND supplier_id = $2 FOR UPDATE`,
      [uuid, supplierId],
    );

    if (!check.rows.length) throw new Error("ORDER_NOT_FOUND");

    const order = check.rows[0];
    if (!["PENDING_SUPPLIER", "CONFIRMED"].includes(order.status)) {
      throw new Error("ORDER_ALREADY_REVIEWED");
    }

    if (action === "approve") {
      // Busca itens do pedido com quantidade em estoque do produto
      const itemsResult = await client.query(
        `SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity,
                p.stock_quantity, p.name
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`,
        [order.id],
      );
      const items = itemsResult.rows;

      // Valida estoque antes de qualquer alteração
      for (const item of items) {
        if (item.stock_quantity !== null && item.stock_quantity < item.quantity) {
          throw new Error(`INSUFFICIENT_STOCK:${item.name}`);
        }
      }

      // Verifica se a tabela stock_movements existe (criada por migration manual)
      const tableCheck = await client.query(
        `SELECT EXISTS (
           SELECT FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'stock_movements'
         ) AS exists`,
      );
      const hasMovementsTable = tableCheck.rows[0].exists;

      // Reduz estoque e registra movimentação para cada item com controle ativo
      for (const item of items) {
        if (item.stock_quantity !== null) {
          const before = item.stock_quantity;
          const after = before - item.quantity;

          await client.query(
            `UPDATE products SET stock_quantity = $1 WHERE id = $2`,
            [after, item.product_id],
          );

          if (hasMovementsTable) {
            await client.query(
              `INSERT INTO stock_movements
               (product_id, variant_id, order_id, quantity_before, quantity_changed, quantity_after, movement_type)
               VALUES ($1, $2, $3, $4, $5, $6, 'sale')`,
              [
                item.product_id,
                item.variant_id || null,
                order.id,
                before,
                -item.quantity,
                after,
              ],
            );
          }
        }
      }
    }

    const result = await client.query(
      `UPDATE orders
       SET status = $1, supplier_comment = $2, supplier_reviewed_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [newStatus, comment || null, order.id],
    );

    await client.query("COMMIT");
    const reviewedOrder = result.rows[0];
    const statusLabel = newStatus === "APPROVED" ? "aprovado" : "reprovado";
    notificationService.createNotification({
      companyId: reviewedOrder.company_id,
      userType: 1,
      title: `Pedido ${statusLabel}`,
      description: comment
        ? `O fornecedor ${statusLabel} seu pedido: "${comment.substring(0, 100)}"`
        : `O fornecedor ${statusLabel} seu pedido`,
      notificationType: "order",
      entityType: "order",
      entityId: reviewedOrder.id,
      entityUuid: uuid,
    }).catch(() => {});
    return reviewedOrder;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { findAll, find, review };
