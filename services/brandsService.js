const pool = require("../db");

/**
 * Get All Brands
 */
const findAll = async (company) => {
  const result = await pool.query("SELECT * FROM brands WHERE company_id = $1 ORDER BY id", [company]);
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query("SELECT * FROM brands WHERE id = $1", [id]);
  return result.rows[0] || null;
};

const create = async (data) => {
  // espera um objeto com propriedades em camelCase (ex: { someField: 'x' })
  const { companyId, name, slug, description, logo, color, originCountry, active, createdAt, updatedAt } = data;
  const iconUrl = data.iconUrl ?? data.icon_url ?? data.icon ?? null;
  const result = await pool.query(
    "INSERT INTO brands (company_id, name, slug, description, logo, icon_url, color, origin_country, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *",
    [companyId, name, slug, description, logo, iconUrl, color, originCountry, active, createdAt, updatedAt],
  );
  return result.rows[0];
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const { id, companyId, name, slug, description, logo, color, originCountry, active, createdAt, updatedAt } = data;
  const iconUrl = data.iconUrl ?? data.icon_url ?? data.icon ?? null;
  const result = await pool.query(
    "UPDATE brands SET company_id = $1, name = $2, slug = $3, description = $4, logo = $5, icon_url = $6, color = $7, origin_country = $8, active = $9, created_at = $10, updated_at = $11 WHERE id = $12 RETURNING *",
    [companyId, name, slug, description, logo, iconUrl, color, originCountry, active, createdAt, updatedAt, id],
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM brands WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove };
