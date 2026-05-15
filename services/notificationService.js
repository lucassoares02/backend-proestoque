const pool = require("../db");

const createNotification = async ({
  companyId,
  userId = null,
  userType = 1,
  title,
  description = null,
  notificationType = "info",
  entityType = null,
  entityId = null,
  entityUuid = null,
  metadata = {},
}) => {
  if (!companyId || !title) return null;
  try {
    const result = await pool.query(
      `INSERT INTO notifications
         (company_id, user_id, user_type, title, description, notification_type,
          entity_type, entity_id, entity_uuid, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        companyId, userId || null, userType, title, description || null, notificationType,
        entityType || null, entityId || null, entityUuid || null, JSON.stringify(metadata),
      ],
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
};

const listForCompany = async (companyId, limit = 60) => {
  const result = await pool.query(
    `SELECT id, uuid, company_id, user_id, user_type, title, description,
            notification_type, entity_type, entity_id, entity_uuid,
            metadata, is_read, read_at, created_at
     FROM notifications
     WHERE company_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [companyId, limit],
  );
  return result.rows;
};

const getUnreadCount = async (companyId) => {
  const result = await pool.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE company_id = $1 AND is_read = false`,
    [companyId],
  );
  return parseInt(result.rows[0].count, 10);
};

const markRead = async (id, companyId) => {
  const result = await pool.query(
    `UPDATE notifications
     SET is_read = true, read_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [id, companyId],
  );
  return result.rows[0] || null;
};

const markAllRead = async (companyId) => {
  await pool.query(
    `UPDATE notifications SET is_read = true, read_at = NOW(), updated_at = NOW()
     WHERE company_id = $1 AND is_read = false`,
    [companyId],
  );
};

const remove = async (id, companyId) => {
  const result = await pool.query(
    "DELETE FROM notifications WHERE id = $1 AND company_id = $2 RETURNING id",
    [id, companyId],
  );
  return result.rows[0] || null;
};

const clearRead = async (companyId) => {
  await pool.query(
    "DELETE FROM notifications WHERE company_id = $1 AND is_read = true",
    [companyId],
  );
};

module.exports = {
  createNotification,
  listForCompany,
  getUnreadCount,
  markRead,
  markAllRead,
  remove,
  clearRead,
};
