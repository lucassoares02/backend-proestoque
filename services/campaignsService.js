const pool = require("../db");

const findAll = async (companyId) => {
  const result = await pool.query(
    `SELECT * FROM supplier_campaigns
     WHERE company_id = $1
     ORDER BY priority DESC, created_at DESC`,
    [companyId],
  );
  return result.rows;
};

const findActive = async (companyId) => {
  const now = new Date().toISOString();
  const result = await pool.query(
    `SELECT * FROM supplier_campaigns
     WHERE company_id = $1
       AND is_active = true
       AND (start_at IS NULL OR start_at <= $2)
       AND (end_at   IS NULL OR end_at   >= $2)
     ORDER BY priority DESC, created_at DESC`,
    [companyId, now],
  );
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query(
    "SELECT * FROM supplier_campaigns WHERE id = $1",
    [id],
  );
  return result.rows[0] || null;
};

const create = async (data) => {
  const {
    companyId, title, description,
    bannerImageUrl, thumbnailImageUrl,
    buttonText, buttonColor, backgroundColor,
    targetUrl, targetType,
    isActive, startAt, endAt, priority,
  } = data;

  const result = await pool.query(
    `INSERT INTO supplier_campaigns
       (company_id, title, description,
        banner_image_url, thumbnail_image_url,
        button_text, button_color, background_color,
        target_url, target_type,
        is_active, start_at, end_at, priority,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     RETURNING *`,
    [
      companyId, title, description ?? null,
      bannerImageUrl ?? null, thumbnailImageUrl ?? null,
      buttonText ?? null, buttonColor ?? "#FF6600", backgroundColor ?? "#FFFFFF",
      targetUrl ?? null, targetType ?? "custom",
      isActive !== false, startAt ?? null, endAt ?? null, priority ?? 0,
    ],
  );
  return result.rows[0];
};

const update = async (data) => {
  const {
    id, companyId, title, description,
    bannerImageUrl, thumbnailImageUrl,
    buttonText, buttonColor, backgroundColor,
    targetUrl, targetType,
    isActive, startAt, endAt, priority,
  } = data;

  const result = await pool.query(
    `UPDATE supplier_campaigns SET
       company_id          = $1,
       title               = $2,
       description         = $3,
       banner_image_url    = $4,
       thumbnail_image_url = $5,
       button_text         = $6,
       button_color        = $7,
       background_color    = $8,
       target_url          = $9,
       target_type         = $10,
       is_active           = $11,
       start_at            = $12,
       end_at              = $13,
       priority            = $14,
       updated_at          = NOW()
     WHERE id = $15
     RETURNING *`,
    [
      companyId, title, description ?? null,
      bannerImageUrl ?? null, thumbnailImageUrl ?? null,
      buttonText ?? null, buttonColor ?? "#FF6600", backgroundColor ?? "#FFFFFF",
      targetUrl ?? null, targetType ?? "custom",
      isActive !== false, startAt ?? null, endAt ?? null, priority ?? 0,
      id,
    ],
  );
  return result.rows[0] || null;
};

const toggle = async (id) => {
  const result = await pool.query(
    `UPDATE supplier_campaigns SET is_active = NOT is_active, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
};

const remove = async (id) => {
  const result = await pool.query(
    "DELETE FROM supplier_campaigns WHERE id = $1 RETURNING *",
    [id],
  );
  return result.rows[0] || null;
};

const registerView = async (id) => {
  await pool.query(
    "UPDATE supplier_campaigns SET views_count = views_count + 1 WHERE id = $1",
    [id],
  );
};

const registerClick = async (id) => {
  await pool.query(
    "UPDATE supplier_campaigns SET clicks_count = clicks_count + 1 WHERE id = $1",
    [id],
  );
};

const getMetrics = async (id) => {
  const result = await pool.query(
    "SELECT views_count, clicks_count FROM supplier_campaigns WHERE id = $1",
    [id],
  );
  if (!result.rows[0]) return null;
  const { views_count, clicks_count } = result.rows[0];
  const ctr = views_count > 0 ? ((clicks_count / views_count) * 100).toFixed(1) : "0.0";
  return { views: views_count, clicks: clicks_count, ctr };
};

// Auto-pause expired campaigns (called on findActive to keep data clean)
const pauseExpired = async () => {
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE supplier_campaigns SET is_active = false, updated_at = NOW()
     WHERE is_active = true AND end_at IS NOT NULL AND end_at < $1`,
    [now],
  );
};

module.exports = { findAll, findActive, find, create, update, toggle, remove, registerView, registerClick, getMetrics, pauseExpired };
