const pool = require("../db");

/**
 * Clientes de um fornecedor.
 *
 * Um "cliente" é toda empresa compradora que, para este fornecedor:
 *   1. já fez ao menos um pedido efetivo (status CONFIRMED/PENDING_SUPPLIER/
 *      APPROVED/REJECTED) — é um comprador; ou
 *   2. abriu um carrinho (pedido em DRAFT) e não finalizou — é um lead, que
 *      recebe a tag especial "Carrinho aberto".
 *
 * A base é a tabela `orders`, autoritativa tanto para pedidos efetivos quanto
 * para carrinhos abertos (status = 'DRAFT').
 */
const listClients = async (supplierId) => {
  const result = await pool.query(
    `SELECT
       c.id,
       c.razao_social,
       c.nome_fantasia,
       c.cnpj,
       c.email,
       c.ddd_telefone1                                                                            AS phone,
       c.municipio,
       c.uf,
       c.logo,
       COUNT(*) FILTER (WHERE o.status IN ('CONFIRMED','PENDING_SUPPLIER','APPROVED','REJECTED'))  AS placed_orders,
       COUNT(*) FILTER (WHERE o.status = 'APPROVED')                                               AS approved_orders,
       COUNT(*) FILTER (WHERE o.status = 'REJECTED')                                               AS rejected_orders,
       COUNT(*) FILTER (WHERE o.status IN ('PENDING_SUPPLIER','CONFIRMED'))                        AS pending_orders,
       COUNT(*) FILTER (WHERE o.status = 'DRAFT')                                                  AS open_carts,
       COALESCE(SUM(o.total_value) FILTER (WHERE o.status = 'APPROVED'), 0)                        AS total_spent,
       COALESCE(SUM(o.total_value) FILTER (WHERE o.status = 'DRAFT'), 0)                           AS open_cart_value,
       MAX(o.created_at) FILTER (WHERE o.status IN ('CONFIRMED','PENDING_SUPPLIER','APPROVED','REJECTED')) AS last_order_at,
       MAX(o.updated_at)                                                                           AS last_activity_at,
       MIN(o.created_at)                                                                           AS first_seen_at
     FROM orders o
     JOIN companies c ON c.id = o.company_id
     WHERE o.supplier_id = $1
       AND o.status IN ('DRAFT','CONFIRMED','PENDING_SUPPLIER','APPROVED','REJECTED')
     GROUP BY c.id
     HAVING COUNT(*) FILTER (WHERE o.status IN ('CONFIRMED','PENDING_SUPPLIER','APPROVED','REJECTED')) > 0
         OR COUNT(*) FILTER (WHERE o.status = 'DRAFT') > 0
     ORDER BY last_activity_at DESC NULLS LAST`,
    [supplierId],
  );

  return result.rows.map((r) => {
    const placedOrders = parseInt(r.placed_orders) || 0;
    const approvedOrders = parseInt(r.approved_orders) || 0;
    const openCarts = parseInt(r.open_carts) || 0;
    const isBuyer = placedOrders > 0;

    return {
      id: r.id,
      razaoSocial: r.razao_social,
      nomeFantasia: r.nome_fantasia,
      cnpj: r.cnpj,
      email: r.email,
      phone: r.phone,
      municipio: r.municipio,
      uf: r.uf,
      logo: r.logo,
      placedOrders,
      approvedOrders,
      rejectedOrders: parseInt(r.rejected_orders) || 0,
      pendingOrders: parseInt(r.pending_orders) || 0,
      openCarts,
      totalSpent: r.total_spent ? parseFloat(r.total_spent) : 0,
      openCartValue: r.open_cart_value ? parseFloat(r.open_cart_value) : 0,
      lastOrderAt: r.last_order_at,
      lastActivityAt: r.last_activity_at,
      firstSeenAt: r.first_seen_at,
      // Classificação: comprador (fez pedido) x lead de carrinho aberto (só DRAFT).
      isBuyer,
      isLead: !isBuyer && openCarts > 0,
      isRecurring: approvedOrders > 1,
      type: isBuyer ? "buyer" : "lead",
    };
  });
};

module.exports = { listClients };
