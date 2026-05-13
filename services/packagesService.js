const pool = require("../db");

/**
 * Get All Packages
 */
const findAll = async () => {
  const result = await pool.query("SELECT * FROM packages ORDER BY id");
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query("SELECT * FROM packages WHERE id = $1", [id]);
  return result.rows[0] || null;
};

const findPackagesProduct = async (id) => {
  const result = await pool.query(
    `SELECT DISTINCT ON (p.id)
        p.id,
        pp2.id AS product_package_id,
        p.title,
        pp2.quantity as "quantity",
        (pp.unit_price/pp2.quantity) AS value
    FROM packages p
    LEFT JOIN products_packages pp2 ON pp2.package_id = p.id
    LEFT JOIN products_prices pp ON pp.product_package_id = pp2.id
    WHERE pp.product_id = $1
    ORDER BY p.id, pp.unit_price;`,
    [id]
  );
  return result.rows || null;
};

const create = async (data) => {
  // espera um objeto com propriedades em camelCase (ex: { someField: 'x' })
  const { id, title, description, material, form, unit, slug, active, createdAt, updatedAt } = data;
  const result = await pool.query(
    "INSERT INTO packages (id, title, description, material, form, unit, slug, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *",
    [id, title, description, material, form, unit, slug, active, createdAt, updatedAt]
  );
  return result.rows[0];
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const { id, title, description, material, form, unit, slug, active, createdAt, updatedAt } = data;
  const result = await pool.query(
    "UPDATE packages SET id = $1, title = $2, description = $3, material = $4, form = $5, unit = $6, slug = $7, active = $8, created_at = $9, updated_at = $10 WHERE id = $11 RETURNING *",
    [id, title, description, material, form, unit, slug, active, createdAt, updatedAt, id]
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM packages WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove, findPackagesProduct };
