const pool = require("../db");

const findAllBySupplier = async (companyId) => {
  const result = await pool.query(
    `SELECT * FROM supplier_stories
     WHERE company_id = $1
     ORDER BY created_at DESC`,
    [companyId],
  );
  return result.rows;
};

const findActiveByCompany = async (companyId) => {
  const now = new Date().toISOString();
  const result = await pool.query(
    `SELECT * FROM supplier_stories
     WHERE company_id = $1
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > $2)
     ORDER BY created_at DESC`,
    [companyId, now],
  );
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query(
    "SELECT * FROM supplier_stories WHERE id = $1",
    [id],
  );
  return result.rows[0] || null;
};

const create = async (data) => {
  const {
    companyId, title, description,
    mediaType, mediaUrl, thumbnailUrl,
    targetType, targetId, targetUrl,
    buttonText, backgroundColor,
    isActive, expiresAt,
  } = data;

  const result = await pool.query(
    `INSERT INTO supplier_stories
       (company_id, title, description,
        media_type, media_url, thumbnail_url,
        target_type, target_id, target_url,
        button_text, background_color,
        is_active, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      companyId, title || null, description || null,
      mediaType || "image", mediaUrl, thumbnailUrl || null,
      targetType || "none", targetId || null, targetUrl || null,
      buttonText || null, backgroundColor || "#000000",
      isActive !== false, expiresAt || null,
    ],
  );
  return result.rows[0];
};

const update = async (data) => {
  const {
    id, title, description,
    mediaType, mediaUrl, thumbnailUrl,
    targetType, targetId, targetUrl,
    buttonText, backgroundColor,
    isActive, expiresAt,
  } = data;

  const result = await pool.query(
    `UPDATE supplier_stories SET
       title            = $1,
       description      = $2,
       media_type       = $3,
       media_url        = $4,
       thumbnail_url    = $5,
       target_type      = $6,
       target_id        = $7,
       target_url       = $8,
       button_text      = $9,
       background_color = $10,
       is_active        = $11,
       expires_at       = $12,
       updated_at       = NOW()
     WHERE id = $13
     RETURNING *`,
    [
      title || null, description || null,
      mediaType || "image", mediaUrl, thumbnailUrl || null,
      targetType || "none", targetId || null, targetUrl || null,
      buttonText || null, backgroundColor || "#000000",
      isActive !== false, expiresAt || null,
      id,
    ],
  );
  return result.rows[0] || null;
};

const toggle = async (id) => {
  const result = await pool.query(
    `UPDATE supplier_stories SET is_active = NOT is_active, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
};

const remove = async (id) => {
  const result = await pool.query(
    "DELETE FROM supplier_stories WHERE id = $1 RETURNING id",
    [id],
  );
  return result.rows[0] || null;
};

const recordView = async (storyId, viewerCompanyId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insert = await client.query(
      `INSERT INTO story_views (story_id, company_id)
       VALUES ($1, $2)
       ON CONFLICT (story_id, company_id) DO NOTHING
       RETURNING id`,
      [storyId, viewerCompanyId],
    );

    await client.query(
      `UPDATE supplier_stories
       SET views_count = views_count + 1,
           unique_views_count = unique_views_count + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [insert.rows.length > 0 ? 1 : 0, storyId],
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const recordClick = async (storyId, viewerCompanyId) => {
  await pool.query(
    "INSERT INTO story_clicks (story_id, company_id) VALUES ($1, $2)",
    [storyId, viewerCompanyId],
  );
  await pool.query(
    `UPDATE supplier_stories SET clicks_count = clicks_count + 1, updated_at = NOW()
     WHERE id = $1`,
    [storyId],
  );
};

const recordReaction = async (storyId, viewerCompanyId, reactionType) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insert = await client.query(
      `INSERT INTO story_reactions (story_id, company_id, reaction_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (story_id, company_id) DO UPDATE SET reaction_type = $3, reacted_at = NOW()
       RETURNING id`,
      [storyId, viewerCompanyId, reactionType || "like"],
    );

    if (insert.rows.length > 0) {
      await client.query(
        `UPDATE supplier_stories SET reactions_count = reactions_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [storyId],
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const addComment = async (storyId, viewerCompanyId, content) => {
  const result = await pool.query(
    `INSERT INTO story_comments (story_id, company_id, content)
     VALUES ($1, $2, $3) RETURNING *`,
    [storyId, viewerCompanyId, content],
  );
  await pool.query(
    `UPDATE supplier_stories SET comments_count = comments_count + 1, updated_at = NOW()
     WHERE id = $1`,
    [storyId],
  );
  return result.rows[0];
};

const getComments = async (storyId) => {
  const result = await pool.query(
    `SELECT sc.*, c.trade_name as company_name
     FROM story_comments sc
     LEFT JOIN companies c ON c.id = sc.company_id
     WHERE sc.story_id = $1 AND sc.is_flagged = false
     ORDER BY sc.created_at ASC`,
    [storyId],
  );
  return result.rows;
};

const getMetrics = async (storyId) => {
  const story = await find(storyId);
  if (!story) return null;

  const reactionsBreakdown = await pool.query(
    `SELECT reaction_type, COUNT(*) as count
     FROM story_reactions WHERE story_id = $1
     GROUP BY reaction_type`,
    [storyId],
  );

  return {
    ...story,
    reactions_breakdown: reactionsBreakdown.rows,
  };
};

module.exports = {
  findAllBySupplier,
  findActiveByCompany,
  find,
  create,
  update,
  toggle,
  remove,
  recordView,
  recordClick,
  recordReaction,
  addComment,
  getComments,
  getMetrics,
};
