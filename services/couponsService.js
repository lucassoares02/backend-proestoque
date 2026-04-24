const pool = require("../db");

/**
 * Get All Coupons
 */
const findAll = async () => {
  const result = await pool.query("SELECT * FROM coupons ORDER BY id");
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query("SELECT * FROM coupons WHERE id = $1", [id]);
  return result.rows[0] || null;
};

const create = async (data) => {
  // espera um objeto com propriedades em camelCase (ex: { someField: 'x' })
  const { id, code, description, discountType, discountValue, minOrderValue, maxDiscountValue, validFrom, validUntil, usageLimit, usageLimitPerCustomer, active, createdAt, updatedAt } = data;
  const result = await pool.query(
    "INSERT INTO coupons (id, code, description, discount_type, discount_value, min_order_value, max_discount_value, valid_from, valid_until, usage_limit, usage_limit_per_customer, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *",
    [id, code, description, discountType, discountValue, minOrderValue, maxDiscountValue, validFrom, validUntil, usageLimit, usageLimitPerCustomer, active, createdAt, updatedAt]
  );
  return result.rows[0];
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const { id, code, description, discountType, discountValue, minOrderValue, maxDiscountValue, validFrom, validUntil, usageLimit, usageLimitPerCustomer, active, createdAt, updatedAt } = data;
  const result = await pool.query(
    "UPDATE coupons SET id = $1, code = $2, description = $3, discount_type = $4, discount_value = $5, min_order_value = $6, max_discount_value = $7, valid_from = $8, valid_until = $9, usage_limit = $10, usage_limit_per_customer = $11, active = $12, created_at = $13, updated_at = $14 WHERE id = $15 RETURNING *",
    [id, code, description, discountType, discountValue, minOrderValue, maxDiscountValue, validFrom, validUntil, usageLimit, usageLimitPerCustomer, active, createdAt, updatedAt, id]
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM coupons WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove };
