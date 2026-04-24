const pool = require("../db");

/**
 * Get All OrdersItem
 */
const findAll = async () => {
  const result = await pool.query("SELECT * FROM order_items ORDER BY id");
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query("SELECT * FROM order_items WHERE id = $1", [id]);
  return result.rows[0] || null;
};

const countOrdersItems = async (company) => {
  const result = await pool.query(
    "SELECT COALESCE(SUM(oi.quantity), 0) AS count, COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.company_id = $1 AND o.status = 'DRAFT';",
    [company],
  );
  return result.rows[0] || null;
};

const create = async (data) => {
  const { order_id, company_id, supplier_id, product_id, quantity, unit_price, total_price, package_id } = data;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Lock lógico por company + supplier
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [company_id, supplier_id]);

    let finalOrderId = order_id;
    const parsedQuantity = Number(quantity);

    // 🔹 Busca ou cria pedido DRAFT
    if (!finalOrderId) {
      const draft = await client.query(
        `
        SELECT id
        FROM orders
        WHERE company_id = $1
          AND supplier_id = $2
          AND status = 'DRAFT'
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [company_id, supplier_id],
      );

      if (draft.rows.length) {
        finalOrderId = draft.rows[0].id;
      } else {
        const created = await client.query(
          `
          INSERT INTO orders (company_id, supplier_id, status, total_value)
          VALUES ($1, $2, 'DRAFT', 0)
          RETURNING id
          `,
          [company_id, supplier_id],
        );
        finalOrderId = created.rows[0].id;
      }
    }

    // 🔹 Remove item apenas daquele package
    if (parsedQuantity === 0) {
      await client.query(
        `
        DELETE FROM order_items
        WHERE order_id = $1
          AND product_id = $2
          AND package_id = $3
        `,
        [finalOrderId, product_id, package_id],
      );
    } else {
      // 🔹 Insere ou atualiza por (order_id, product_id, package_id)
      const res = await client.query(
        `
        INSERT INTO order_items
          (order_id, product_id, package_id, quantity, unit_price, total_price)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (order_id, product_id, package_id)
        DO UPDATE SET
          quantity = EXCLUDED.quantity,
          unit_price = EXCLUDED.unit_price,
          total_price = EXCLUDED.total_price,
          updated_at = NOW()
        RETURNING *
        `,
        [finalOrderId, product_id, package_id, parsedQuantity, unit_price, total_price],
      );

      if (!res.rows.length) {
        throw new Error("Item não foi inserido nem atualizado");
      }
    }

    // 🔹 Recalcula total do pedido
    await client.query(
      `
      UPDATE orders
      SET total_value = (
        SELECT COALESCE(SUM(total_price), 0)
        FROM order_items
        WHERE order_id = $1
      ),
      updated_at = NOW()
      WHERE id = $1
      `,
      [finalOrderId],
    );

    await client.query("COMMIT");

    return { order_id: finalOrderId };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ERRO CREATE ORDER ITEM:", error);
    throw error;
  } finally {
    client.release();
  }
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const { id, orderId, productId, quantity, unitPrice, totalPrice, createdAt, updatedAt } = data;
  const result = await pool.query(
    "UPDATE order_items SET id = $1, order_id = $2, product_id = $3, quantity = $4, unit_price = $5, total_price = $6, created_at = $7, updated_at = $8 WHERE id = $9 RETURNING *",
    [id, orderId, productId, quantity, unitPrice, totalPrice, createdAt, updatedAt, id],
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM order_items WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove, countOrdersItems };
