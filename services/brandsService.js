const pool = require("../db");

/**
 * Get All Brands
 */
const findAll = async (company) => {
  const result = await pool.query(
    `SELECT b.*, u.name AS consultant_name
     FROM brands b
     LEFT JOIN users u ON u.id = b.consultant_user_id
     WHERE b.company_id = $1
     ORDER BY b.id`,
    [company],
  );
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query(
    `SELECT b.*, u.name AS consultant_name
     FROM brands b
     LEFT JOIN users u ON u.id = b.consultant_user_id
     WHERE b.id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

// Normaliza os campos do consultor vindos do payload (camelCase ou snake_case).
const _consultantFields = (data) => {
  const userId = data.consultantUserId ?? data.consultant_user_id ?? null;
  const rawPct = data.consultantSalesPercentage ?? data.consultant_sales_percentage ?? null;
  const pct = rawPct === null || rawPct === "" ? null : Number(rawPct);
  return { consultantUserId: userId, consultantSalesPercentage: pct };
};

const create = async (data) => {
  // espera um objeto com propriedades em camelCase (ex: { someField: 'x' })
  const { companyId, name, slug, description, logo, color, originCountry, active, createdAt, updatedAt } = data;
  const iconUrl = data.iconUrl ?? data.icon_url ?? data.icon ?? null;
  const { consultantUserId, consultantSalesPercentage } = _consultantFields(data);
  const result = await pool.query(
    "INSERT INTO brands (company_id, name, slug, description, logo, icon_url, color, origin_country, active, consultant_user_id, consultant_sales_percentage, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *",
    [companyId, name, slug, description, logo, iconUrl, color, originCountry, active, consultantUserId, consultantSalesPercentage, createdAt, updatedAt],
  );
  return result.rows[0];
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const { id, companyId, name, slug, description, logo, color, originCountry, active, createdAt, updatedAt } = data;
  const iconUrl = data.iconUrl ?? data.icon_url ?? data.icon ?? null;
  const { consultantUserId, consultantSalesPercentage } = _consultantFields(data);
  const result = await pool.query(
    "UPDATE brands SET company_id = $1, name = $2, slug = $3, description = $4, logo = $5, icon_url = $6, color = $7, origin_country = $8, active = $9, consultant_user_id = $10, consultant_sales_percentage = $11, created_at = $12, updated_at = $13 WHERE id = $14 RETURNING *",
    [companyId, name, slug, description, logo, iconUrl, color, originCountry, active, consultantUserId, consultantSalesPercentage, createdAt, updatedAt, id],
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM brands WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove };
