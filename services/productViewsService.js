const pool = require("../db");

/** Registra a visualização de um produto pelo cliente (alimenta "Continuar comprando"). */
const registerView = async (productId, companyId, supplierId) => {
  if (!productId || !companyId) return;
  await pool.query(
    `INSERT INTO product_views (product_id, company_id, supplier_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [productId, companyId, supplierId ?? null],
  );
};

module.exports = { registerView };
