const pool = require("../db");
const cartTracking = require("./cartTrackingService");

/**
 * Jornada do Cliente: registra o evento de tracking correspondente à mutação
 * do item do carrinho (adição, alteração de quantidade, remoção ou bonificação).
 * Fire-and-forget — nunca falha a operação principal.
 */
const _fireCartEvent = async ({
  supplierId,
  buyerCompanyId,
  orderId,
  productId,
  variantId,
  packageId,
  isBonus,
  bonusRuleId,
  prevQuantity,
  newQuantity,
  unitPrice,
  totalPrice,
}) => {
  try {
    if (!supplierId || !buyerCompanyId || !orderId || !productId) return;
    if (prevQuantity === newQuantity) return;

    const base = {
      supplierId,
      buyerCompanyId,
      orderId,
      productId,
      variantId: variantId ?? null,
      stepName: "cart",
    };

    if (isBonus) {
      // Item bônus inserido/atualizado pelo motor de bonificações.
      if (newQuantity <= 0) return; // remoção de bônus não gera evento
      const metadata = {
        is_bonus: true,
        bonus_rule_id: bonusRuleId ?? null,
        bonus_quantity: newQuantity,
        package_id: packageId ?? null,
      };
      if (bonusRuleId) {
        const rule = await pool.query(
          `SELECT name, minimum_quantity, bonus_quantity FROM bonus_rules WHERE id = $1`,
          [bonusRuleId],
        );
        if (rule.rows[0]) {
          metadata.rule_name = rule.rows[0].name;
          metadata.trigger_quantity = rule.rows[0].minimum_quantity;
          metadata.rule_bonus_quantity = rule.rows[0].bonus_quantity;
        }
      }
      await cartTracking.saveEvent({
        ...base,
        eventType: "bonus_unlocked",
        quantity: newQuantity,
        metadata,
      });
      return;
    }

    if (prevQuantity === 0 && newQuantity > 0) {
      await cartTracking.saveEvent({
        ...base,
        eventType: "product_added",
        quantity: newQuantity,
        metadata: {
          quantity: newQuantity,
          unit_price: unitPrice ?? null,
          total_price: totalPrice ?? null,
          package_id: packageId ?? null,
        },
      });
    } else if (newQuantity === 0 && prevQuantity > 0) {
      await cartTracking.saveEvent({
        ...base,
        eventType: "product_removed",
        quantity: prevQuantity,
        metadata: {
          removed_quantity: prevQuantity,
          package_id: packageId ?? null,
        },
      });
    } else {
      await cartTracking.saveEvent({
        ...base,
        eventType: "quantity_changed",
        quantity: newQuantity,
        metadata: {
          previous_quantity: prevQuantity,
          new_quantity: newQuantity,
          unit_price: unitPrice ?? null,
          package_id: packageId ?? null,
        },
      });
    }
  } catch (e) {
    console.error("[orders_itemService] _fireCartEvent error:", e.message);
  }
};

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
  const {
    order_id,
    company_id,
    supplier_id,
    product_id,
    quantity,
    unit_price,
    total_price,
    package_id,
    buy_together_campaign_id,
    buy_together_applied,
    variant_id,
    is_bonus,
    bonus_rule_id,
  } = data;

  // Itens bônus sempre têm preço zero — qualquer valor recebido é ignorado.
  const finalUnitPrice = is_bonus ? 0 : unit_price;
  const finalTotalPrice = is_bonus ? 0 : total_price;

  console.log("[ORDERS_ITEM CREATE] payload received:", {
    order_id, company_id, supplier_id, product_id, package_id, variant_id, quantity, is_bonus,
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Lock lógico por company + supplier
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [company_id, supplier_id]);

    const parsedQuantity = Number(quantity);
    let finalOrderId = order_id ? Number(order_id) : null;

    if (finalOrderId) {
      const currentDraft = await client.query(
        `
        SELECT id
        FROM orders
        WHERE id = $1
          AND company_id = $2
          AND supplier_id = $3
          AND status = 'DRAFT'
        LIMIT 1
        `,
        [finalOrderId, company_id, supplier_id],
      );

      if (!currentDraft.rows.length) {
        finalOrderId = null;
      }
    }

    // 🔹 Busca ou cria pedido DRAFT
    if (!finalOrderId) {
      if (parsedQuantity === 0) {
        await client.query("COMMIT");
        return {
          order_id: order_id ? Number(order_id) : null,
          remaining_items: 0,
          order_removed: true,
        };
      }

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

    // 🔹 Quantidade anterior do item (mesma chave) — usada para decidir qual
    //    evento da Jornada do Cliente registrar após o COMMIT.
    const prevRes = await client.query(
      `
      SELECT quantity
      FROM order_items
      WHERE order_id = $1
        AND product_id = $2
        AND package_id IS NOT DISTINCT FROM $3
        AND variant_id IS NOT DISTINCT FROM $4
        AND COALESCE(is_bonus, false) = $5
      LIMIT 1
      `,
      [finalOrderId, product_id, package_id ?? null, variant_id ?? null, is_bonus ?? false],
    );
    const prevQuantity = prevRes.rows[0] ? Number(prevRes.rows[0].quantity) : 0;

    // 🔹 Remove item discriminando por package + variant + is_bonus
    //    Itens normais e itens bônus são distintos mesmo com mesmo produto/variação/pack.
    if (parsedQuantity === 0) {
      await client.query(
        `
        DELETE FROM order_items
        WHERE order_id = $1
          AND product_id = $2
          AND package_id IS NOT DISTINCT FROM $3
          AND variant_id IS NOT DISTINCT FROM $4
          AND COALESCE(is_bonus, false) = $5
        `,
        [finalOrderId, product_id, package_id ?? null, variant_id ?? null, is_bonus ?? false],
      );
    } else {
      const updateRes = await client.query(
        `
        UPDATE order_items
        SET quantity = $4,
            unit_price = $5,
            total_price = $6,
            buy_together_campaign_id = $7,
            buy_together_applied = $8,
            is_bonus = $10,
            bonus_rule_id = $11,
            updated_at = NOW()
        WHERE order_id = $1
          AND product_id = $2
          AND package_id IS NOT DISTINCT FROM $3
          AND variant_id IS NOT DISTINCT FROM $9
          AND COALESCE(is_bonus, false) = $10
        RETURNING *
        `,
        [
          finalOrderId,
          product_id,
          package_id ?? null,
          parsedQuantity,
          finalUnitPrice,
          finalTotalPrice,
          buy_together_campaign_id ?? null,
          buy_together_applied ?? false,
          variant_id ?? null,
          is_bonus ?? false,
          bonus_rule_id ?? null,
        ],
      );

      if (updateRes.rowCount === 0) {
        const insertRes = await client.query(
          `
          INSERT INTO order_items
            (order_id, product_id, package_id, quantity, unit_price, total_price,
             buy_together_campaign_id, buy_together_applied, variant_id, is_bonus, bonus_rule_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
          `,
          [
            finalOrderId,
            product_id,
            package_id ?? null,
            parsedQuantity,
            finalUnitPrice,
            finalTotalPrice,
            buy_together_campaign_id ?? null,
            buy_together_applied ?? false,
            variant_id ?? null,
            is_bonus ?? false,
            bonus_rule_id ?? null,
          ],
        );
        if (!insertRes.rows.length) {
          throw new Error("Item não foi inserido");
        }
      }
    }

    const remainingItems = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM order_items
      WHERE order_id = $1
      `,
      [finalOrderId],
    );
    const remainingItemCount = remainingItems.rows[0]?.count ?? 0;
    let orderRemoved = false;

    if (parsedQuantity === 0 && remainingItemCount === 0) {
      await client.query(
        `
        DELETE FROM orders
        WHERE id = $1
          AND status = 'DRAFT'
        `,
        [finalOrderId],
      );
      orderRemoved = true;
    }

    // 🔹 Recalcula total do pedido
    if (!orderRemoved) {
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
    }

    await client.query("COMMIT");

    // Jornada do Cliente — registrado fora da transação para nunca afetar o pedido.
    _fireCartEvent({
      supplierId: supplier_id,
      buyerCompanyId: company_id,
      orderId: finalOrderId,
      productId: product_id,
      variantId: variant_id ?? null,
      packageId: package_id ?? null,
      isBonus: is_bonus ?? false,
      bonusRuleId: bonus_rule_id ?? null,
      prevQuantity,
      newQuantity: parsedQuantity,
      unitPrice: finalUnitPrice,
      totalPrice: finalTotalPrice,
    });

    return {
      order_id: finalOrderId,
      remaining_items: remainingItemCount,
      order_removed: orderRemoved,
    };
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
