const pool = require("../db");

/**
 * Clientes da plataforma, com as métricas de relacionamento com este fornecedor.
 *
 * A base agora é a tabela `companies`: retorna TODA empresa cliente da
 * plataforma (que possui vínculo `users_companies.relation_type = 1`), mesmo as
 * que nunca interagiram com esta loja. As métricas de pedidos/carrinho vêm de
 * um LEFT JOIN em `orders` restrito a este fornecedor.
 *
 * A ordenação prioriza quem já se relacionou com a loja:
 *   0. compradores  — fez ao menos um pedido efetivo
 *      (CONFIRMED/PENDING_SUPPLIER/APPROVED/REJECTED);
 *   1. carrinho aberto — só possui pedido em DRAFT (lead);
 *   2. sem interação — cliente da plataforma que nunca comprou/abriu carrinho.
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
     FROM companies c
     LEFT JOIN orders o
       ON o.company_id = c.id
       AND o.supplier_id = $1
       AND o.status IN ('DRAFT','CONFIRMED','PENDING_SUPPLIER','APPROVED','REJECTED')
     WHERE c.id <> $1
       AND EXISTS (
         SELECT 1 FROM users_companies uc
         WHERE uc.company_id = c.id AND uc.relation_type = 1
       )
     GROUP BY c.id
     ORDER BY
       CASE
         WHEN COUNT(*) FILTER (WHERE o.status IN ('CONFIRMED','PENDING_SUPPLIER','APPROVED','REJECTED')) > 0 THEN 0
         WHEN COUNT(*) FILTER (WHERE o.status = 'DRAFT') > 0 THEN 1
         ELSE 2
       END,
       MAX(o.updated_at) DESC NULLS LAST,
       COALESCE(c.nome_fantasia, c.razao_social) ASC NULLS LAST`,
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
      // Classificação: comprador (fez pedido) x lead de carrinho aberto (só
      // DRAFT) x prospect (cliente da plataforma sem interação com a loja).
      isBuyer,
      isLead: !isBuyer && openCarts > 0,
      isRecurring: approvedOrders > 1,
      type: isBuyer ? "buyer" : openCarts > 0 ? "lead" : "prospect",
    };
  });
};

module.exports = { listClients };
