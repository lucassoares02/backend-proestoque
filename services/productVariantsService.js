const pool = require("../db");

const findByProduct = async (productId) => {
  const result = await pool.query(
    `SELECT * FROM product_variants
     WHERE product_id = $1
     ORDER BY sort_order, id`,
    [productId],
  );
  return result.rows;
};

const findOne = async (productId, variantId) => {
  const result = await pool.query(
    `SELECT * FROM product_variants WHERE id = $1 AND product_id = $2`,
    [variantId, productId],
  );
  return result.rows[0] || null;
};

const create = async (productId, data) => {
  const { name, sku, ean, weight, content, price, image_url, active, sort_order } = data;

  if (!name || !name.trim()) {
    const err = new Error("O nome da variação é obrigatório.");
    err.status = 422;
    throw err;
  }

  const result = await pool.query(
    `INSERT INTO product_variants
       (product_id, name, sku, ean, weight, content, price, image_url, active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      productId,
      name.trim(),
      sku?.trim() || null,
      ean?.trim() || null,
      weight != null ? Number(weight) : null,
      content != null ? Number(content) : null,
      price != null ? Number(price) : null,
      image_url?.trim() || null,
      active !== false,
      Number(sort_order) || 0,
    ],
  );
  return result.rows[0];
};

const update = async (productId, variantId, data) => {
  const { name, sku, ean, weight, content, price, image_url, active, sort_order } = data;

  if (!name || !name.trim()) {
    const err = new Error("O nome da variação é obrigatório.");
    err.status = 422;
    throw err;
  }

  const result = await pool.query(
    `UPDATE product_variants SET
       name       = $1,
       sku        = $2,
       ean        = $3,
       weight     = $4,
       content    = $5,
       price      = $6,
       image_url  = $7,
       active     = $8,
       sort_order = $9,
       updated_at = NOW()
     WHERE id = $10 AND product_id = $11
     RETURNING *`,
    [
      name.trim(),
      sku?.trim() || null,
      ean?.trim() || null,
      weight != null ? Number(weight) : null,
      content != null ? Number(content) : null,
      price != null ? Number(price) : null,
      image_url?.trim() || null,
      active !== false,
      Number(sort_order) || 0,
      variantId,
      productId,
    ],
  );
  return result.rows[0] || null;
};

const remove = async (productId, variantId) => {
  const result = await pool.query(
    `DELETE FROM product_variants WHERE id = $1 AND product_id = $2 RETURNING *`,
    [variantId, productId],
  );
  return result.rows[0] || null;
};

module.exports = { findByProduct, findOne, create, update, remove };
