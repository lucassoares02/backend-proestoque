const pool = require("../db");

/**
 * Get All products_categories
 */
const findAll = async () => {
  const result = await pool.query("SELECT * FROM products_categories where parent_id is not null ORDER BY id");
  return result.rows;
};

/**
 * Get All products_categories for a specific supplier
 */
const findCategoriesSupplier = async (id) => {
  const result = await pool.query(
    `SELECT DISTINCT pc.id, pc.name, pc.slug, pc.description, pc.image_url, pc.sort_order, pc.parent_id, parent.name AS parent_name FROM products_categories pc INNER JOIN products p ON p.category_id = pc.id AND p.active = true AND p.deleted_at IS NULL LEFT JOIN products_categories parent ON parent.id = pc.parent_id WHERE p.company_id = ${id} AND pc.active = true ORDER BY pc.sort_order ASC, pc.name ASC;`,
  );
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query("SELECT * FROM products_categories WHERE id = $1", [id]);
  return result.rows[0] || null;
};

const create = async (data) => {
  // espera um objeto com propriedades em camelCase (ex: { someField: 'x' })
  const { id, name, description, slug, parentId, imageUrl, sortOrder, active, createdAt, updatedAt } = data;
  const result = await pool.query(
    "INSERT INTO products_categories (id, name, description, slug, parent_id, image_url, sort_order, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *",
    [id, name, description, slug, parentId, imageUrl, sortOrder, active, createdAt, updatedAt],
  );
  return result.rows[0];
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const { id, name, description, slug, parentId, imageUrl, sortOrder, active, createdAt, updatedAt } = data;
  const result = await pool.query(
    "UPDATE products_categories SET id = $1, name = $2, description = $3, slug = $4, parent_id = $5, image_url = $6, sort_order = $7, active = $8, created_at = $9, updated_at = $10 WHERE id = $11 RETURNING *",
    [id, name, description, slug, parentId, imageUrl, sortOrder, active, createdAt, updatedAt, id],
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM products_categories WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, findCategoriesSupplier, find, create, update, remove };
