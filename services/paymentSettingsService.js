const pool = require("../db");

const VALID_METHODS = ["PIX", "BOLETO", "CREDITO_COMERCIAL", "TRANSFERENCIA_BANCARIA"];

const _normMethods = (arr) =>
  Array.isArray(arr) ? arr.filter((m) => VALID_METHODS.includes(m)) : null;

// ─── Geral (fornecedor) ───────────────────────────────────────────────

const findGeneral = async (supplierId) => {
  const result = await pool.query(
    `SELECT * FROM payment_settings WHERE supplier_id = $1`,
    [supplierId],
  );
  return result.rows[0] || null;
};

const upsertGeneral = async (supplierId, data) => {
  const { allowed_methods, boleto_terms, first_order_required_method, first_order_max_amount, minimum_order_amount } = data;

  const methods = _normMethods(allowed_methods) ?? ["PIX"];
  const terms = Array.isArray(boleto_terms) ? boleto_terms.map(Number).filter(Boolean) : [7, 14, 28];
  const firstMethod = VALID_METHODS.includes(first_order_required_method) ? first_order_required_method : null;
  const firstMax = first_order_max_amount != null ? Number(first_order_max_amount) : null;
  const minOrder = minimum_order_amount != null ? Number(minimum_order_amount) : null;

  if (minOrder != null && firstMax != null && minOrder > firstMax) {
    const err = new Error("O pedido mínimo não pode ser maior que o valor máximo do primeiro pedido.");
    err.status = 422;
    throw err;
  }

  const result = await pool.query(
    `
    INSERT INTO payment_settings
      (supplier_id, allowed_methods, boleto_terms, first_order_required_method, first_order_max_amount, minimum_order_amount, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (supplier_id) DO UPDATE SET
      allowed_methods             = EXCLUDED.allowed_methods,
      boleto_terms                = EXCLUDED.boleto_terms,
      first_order_required_method = EXCLUDED.first_order_required_method,
      first_order_max_amount      = EXCLUDED.first_order_max_amount,
      minimum_order_amount        = EXCLUDED.minimum_order_amount,
      updated_at                  = NOW()
    RETURNING *
    `,
    [supplierId, methods, terms, firstMethod, firstMax, minOrder],
  );
  return result.rows[0];
};

// ─── Por cliente ──────────────────────────────────────────────────────

const listCustomers = async (supplierId) => {
  const result = await pool.query(
    `
    SELECT
      cps.*,
      c.id             AS company_id,
      COALESCE(c.nome_fantasia, c.razao_social) AS company_name,
      c.cnpj AS company_cnpj
    FROM customer_payment_settings cps
    JOIN companies c ON c.id = cps.customer_id
    WHERE cps.supplier_id = $1
    ORDER BY company_name
    `,
    [supplierId],
  );
  return result.rows;
};

const findCustomer = async (supplierId, customerId) => {
  const result = await pool.query(
    `SELECT cps.*, COALESCE(c.nome_fantasia, c.razao_social) AS company_name, c.cnpj AS company_cnpj
     FROM customer_payment_settings cps
     JOIN companies c ON c.id = cps.customer_id
     WHERE cps.supplier_id = $1 AND cps.customer_id = $2`,
    [supplierId, customerId],
  );
  return result.rows[0] || null;
};

const upsertCustomer = async (supplierId, customerId, data) => {
  const { allowed_methods, boleto_terms, credit_limit, first_order_limit, is_known_customer } = data;

  const methods = _normMethods(allowed_methods);
  const terms = Array.isArray(boleto_terms) ? boleto_terms.map(Number).filter(Boolean) : null;
  const creditLim = credit_limit != null ? Number(credit_limit) : null;
  const firstLim = first_order_limit != null ? Number(first_order_limit) : null;
  const known = typeof is_known_customer === "boolean" ? is_known_customer : false;

  const result = await pool.query(
    `
    INSERT INTO customer_payment_settings
      (supplier_id, customer_id, allowed_methods, boleto_terms, credit_limit, first_order_limit, is_known_customer, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (supplier_id, customer_id) DO UPDATE SET
      allowed_methods   = EXCLUDED.allowed_methods,
      boleto_terms      = EXCLUDED.boleto_terms,
      credit_limit      = EXCLUDED.credit_limit,
      first_order_limit = EXCLUDED.first_order_limit,
      is_known_customer = EXCLUDED.is_known_customer,
      updated_at        = NOW()
    RETURNING *
    `,
    [supplierId, customerId, methods, terms, creditLim, firstLim, known],
  );
  return result.rows[0];
};

const removeCustomer = async (supplierId, customerId) => {
  const result = await pool.query(
    `DELETE FROM customer_payment_settings WHERE supplier_id = $1 AND customer_id = $2 RETURNING *`,
    [supplierId, customerId],
  );
  return result.rows[0] || null;
};

// ─── Resolução (checkout) ─────────────────────────────────────────────

/**
 * Devolve a config efetiva para um par (supplier, customer):
 * Herda os campos gerais quando a config de cliente não sobrescreve.
 */
const resolveForCheckout = async (supplierId, customerId) => {
  const [general, customer] = await Promise.all([
    findGeneral(supplierId),
    findCustomer(supplierId, customerId),
  ]);

  const base = general || { allowed_methods: ["PIX"], boleto_terms: [7, 14, 28], first_order_required_method: null, first_order_max_amount: null };

  return {
    allowed_methods: customer?.allowed_methods ?? base.allowed_methods,
    boleto_terms: customer?.boleto_terms ?? base.boleto_terms,
    first_order_required_method: base.first_order_required_method,
    first_order_max_amount: customer?.first_order_limit ?? base.first_order_max_amount,
    minimum_order_amount: base.minimum_order_amount ?? null,
    credit_limit: customer?.credit_limit ?? null,
    is_known_customer: customer?.is_known_customer ?? false,
  };
};

/**
 * Returns all companies that have ever placed an order with this supplier.
 * Used in the "add customer config" search.
 */
const listSupplierCustomers = async (supplierId) => {
  const result = await pool.query(
    `SELECT DISTINCT c.id, COALESCE(c.nome_fantasia, c.razao_social) AS name, c.cnpj
     FROM companies c
     JOIN orders o ON o.company_id = c.id
     WHERE o.supplier_id = $1
     ORDER BY name`,
    [supplierId],
  );
  return result.rows;
};

module.exports = { findGeneral, upsertGeneral, listCustomers, findCustomer, upsertCustomer, removeCustomer, resolveForCheckout, listSupplierCustomers };
