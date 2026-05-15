const pool = require("../db");
const notificationService = require("./notificationService");

// ── Helpers ───────────────────────────────────────────────────────────────────

const _mediaItemsSubquery = `
  COALESCE(
    (SELECT json_agg(
       json_build_object(
         'id',               mi.id,
         'story_id',         mi.story_id,
         'sort_order',       mi.sort_order,
         'media_type',       mi.media_type,
         'media_url',        mi.media_url,
         'thumbnail_url',    mi.thumbnail_url,
         'duration_seconds', mi.duration_seconds,
         'created_at',       mi.created_at
       ) ORDER BY mi.sort_order
     )
     FROM story_media_items mi WHERE mi.story_id = s.id
    ),
    '[]'::json
  ) AS media_items
`;

const findAllBySupplier = async (companyId) => {
  const result = await pool.query(
    `SELECT s.*, ${_mediaItemsSubquery}
     FROM supplier_stories s
     WHERE s.company_id = $1
     ORDER BY s.created_at DESC`,
    [companyId],
  );
  return result.rows;
};

const findActiveByCompany = async (companyId, viewerCompanyId) => {
  const now = new Date().toISOString();

  if (viewerCompanyId) {
    // Order: unviewed stories first, then by newest
    const result = await pool.query(
      `SELECT s.*, ${_mediaItemsSubquery},
              (sv.id IS NOT NULL) AS is_viewed
       FROM supplier_stories s
       LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.company_id = $3
       WHERE s.company_id = $1
         AND s.is_active = true
         AND (s.expires_at IS NULL OR s.expires_at > $2)
       ORDER BY is_viewed ASC, s.created_at DESC`,
      [companyId, now, viewerCompanyId],
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT s.*, ${_mediaItemsSubquery}, false AS is_viewed
     FROM supplier_stories s
     WHERE s.company_id = $1
       AND s.is_active = true
       AND (s.expires_at IS NULL OR s.expires_at > $2)
     ORDER BY s.created_at DESC`,
    [companyId, now],
  );
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query(
    `SELECT s.*, ${_mediaItemsSubquery}
     FROM supplier_stories s
     WHERE s.id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

// ── Insert/Replace media items (within a transaction client) ──────────────────

const _replaceMediaItems = async (client, storyId, mediaItems) => {
  await client.query("DELETE FROM story_media_items WHERE story_id = $1", [storyId]);
  if (!mediaItems || mediaItems.length === 0) return;
  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    await client.query(
      `INSERT INTO story_media_items
         (story_id, sort_order, media_type, media_url, thumbnail_url, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        storyId,
        i,
        item.mediaType || item.media_type || "image",
        item.mediaUrl || item.media_url,
        item.thumbnailUrl || item.thumbnail_url || null,
        item.durationSeconds || item.duration_seconds || 5,
      ],
    );
  }
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

const create = async (data) => {
  const {
    companyId, title, description,
    mediaType, mediaUrl, thumbnailUrl,
    targetType, targetId, targetUrl,
    buttonText, backgroundColor,
    isActive, expiresAt,
    mediaItems,
  } = data;

  const effectiveMediaUrl =
    mediaUrl ||
    (mediaItems && mediaItems.length > 0 ? mediaItems[0].mediaUrl || mediaItems[0].media_url : null) ||
    "";
  const effectiveMediaType =
    mediaType ||
    (mediaItems && mediaItems.length > 0 ? mediaItems[0].mediaType || mediaItems[0].media_type : "image");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
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
        effectiveMediaType, effectiveMediaUrl, thumbnailUrl || null,
        targetType || "none", targetId || null, targetUrl || null,
        buttonText || null, backgroundColor || "#000000",
        isActive !== false, expiresAt || null,
      ],
    );
    const story = result.rows[0];

    if (mediaItems && mediaItems.length > 0) {
      await _replaceMediaItems(client, story.id, mediaItems);
    }

    await client.query("COMMIT");
    return await find(story.id);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const update = async (data) => {
  const {
    id, title, description,
    mediaType, mediaUrl, thumbnailUrl,
    targetType, targetId, targetUrl,
    buttonText, backgroundColor,
    isActive, expiresAt,
    mediaItems,
  } = data;

  const effectiveMediaUrl =
    mediaUrl ||
    (mediaItems && mediaItems.length > 0 ? mediaItems[0].mediaUrl || mediaItems[0].media_url : undefined);
  const effectiveMediaType =
    mediaType ||
    (mediaItems && mediaItems.length > 0 ? mediaItems[0].mediaType || mediaItems[0].media_type : undefined);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sets = [
      "title = $1",
      "description = $2",
      "thumbnail_url = $3",
      "target_type = $4",
      "target_id = $5",
      "target_url = $6",
      "button_text = $7",
      "background_color = $8",
      "is_active = $9",
      "expires_at = $10",
      "updated_at = NOW()",
    ];
    const params = [
      title || null, description || null,
      thumbnailUrl !== undefined ? thumbnailUrl || null : undefined,
      targetType || "none", targetId || null, targetUrl || null,
      buttonText || null, backgroundColor || "#000000",
      isActive !== false, expiresAt || null,
    ];

    if (effectiveMediaUrl !== undefined) {
      sets.push(`media_url = $${params.length + 1}`);
      params.push(effectiveMediaUrl);
    }
    if (effectiveMediaType !== undefined) {
      sets.push(`media_type = $${params.length + 1}`);
      params.push(effectiveMediaType);
    }

    params.push(id);
    const result = await client.query(
      `UPDATE supplier_stories SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    if (mediaItems !== undefined) {
      await _replaceMediaItems(client, id, mediaItems);
    }

    await client.query("COMMIT");
    return await find(id);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
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

// ── Media items CRUD ──────────────────────────────────────────────────────────

const addMediaItem = async (storyId, { mediaType, mediaUrl, thumbnailUrl, durationSeconds }) => {
  const order = await pool.query(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM story_media_items WHERE story_id = $1",
    [storyId],
  );
  const sortOrder = order.rows[0].next;
  const result = await pool.query(
    `INSERT INTO story_media_items (story_id, sort_order, media_type, media_url, thumbnail_url, duration_seconds)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [storyId, sortOrder, mediaType || "image", mediaUrl, thumbnailUrl || null, durationSeconds || 5],
  );
  return result.rows[0];
};

const removeMediaItem = async (itemId) => {
  const result = await pool.query(
    "DELETE FROM story_media_items WHERE id = $1 RETURNING *",
    [itemId],
  );
  return result.rows[0] || null;
};

const reorderMediaItems = async (storyId, orderedIds) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        "UPDATE story_media_items SET sort_order = $1 WHERE id = $2 AND story_id = $3",
        [i, orderedIds[i], storyId],
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

// ── Analytics ─────────────────────────────────────────────────────────────────

const recordView = async (storyId, viewerCompanyId, mediaItemId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insert = await client.query(
      `INSERT INTO story_views (story_id, company_id, media_item_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (story_id, company_id) DO NOTHING
       RETURNING id`,
      [storyId, viewerCompanyId, mediaItemId || null],
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
    if (insert.rows.length > 0) {
      pool.query('SELECT company_id FROM supplier_stories WHERE id = $1', [storyId])
        .then(r => {
          if (!r.rows.length) return;
          const storyCompanyId = r.rows[0].company_id;
          if (storyCompanyId === viewerCompanyId) return;
          return notificationService.createNotification({
            companyId: storyCompanyId,
            userType: 2,
            title: 'Nova reação em um Story',
            description: `${userName || 'Um cliente'} reagiu ao seu story`,
            notificationType: 'story',
            entityType: 'story',
            entityId: storyId,
          });
        }).catch(() => {});
    }
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const recordClick = async (storyId, viewerCompanyId, mediaItemId) => {
  await pool.query(
    "INSERT INTO story_clicks (story_id, company_id, media_item_id) VALUES ($1, $2, $3)",
    [storyId, viewerCompanyId, mediaItemId || null],
  );
  await pool.query(
    `UPDATE supplier_stories SET clicks_count = clicks_count + 1, updated_at = NOW()
     WHERE id = $1`,
    [storyId],
  );
};

const recordReaction = async (storyId, viewerCompanyId, reactionType, userId, userName) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insert = await client.query(
      `INSERT INTO story_reactions (story_id, company_id, reaction_type, user_id, user_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (story_id, company_id) DO UPDATE
         SET reaction_type = $3, user_id = $4, user_name = $5, reacted_at = NOW()
       RETURNING id`,
      [storyId, viewerCompanyId, reactionType || "like", userId || null, userName || null],
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

const addComment = async (storyId, viewerCompanyId, content, userId, userName, parentId) => {
  const result = await pool.query(
    `INSERT INTO story_comments (story_id, company_id, content, user_id, user_name, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [storyId, viewerCompanyId, content, userId || null, userName || null, parentId || null],
  );
  await pool.query(
    `UPDATE supplier_stories SET comments_count = comments_count + 1, updated_at = NOW()
     WHERE id = $1`,
    [storyId],
  );
  pool.query('SELECT company_id FROM supplier_stories WHERE id = $1', [storyId])
    .then(r => {
      if (!r.rows.length) return;
      const storyCompanyId = r.rows[0].company_id;
      if (storyCompanyId === viewerCompanyId) return;
      return notificationService.createNotification({
        companyId: storyCompanyId,
        userType: 2,
        title: 'Novo comentário em um Story',
        description: `${userName || 'Um cliente'} comentou: "${(content || '').substring(0, 100)}"`,
        notificationType: 'story',
        entityType: 'story',
        entityId: storyId,
      });
    }).catch(() => {});
  return result.rows[0];
};

const getComments = async (storyId) => {
  const result = await pool.query(
    `SELECT
       sc.id, sc.uuid, sc.story_id, sc.company_id,
       sc.user_id,
       COALESCE(sc.user_name, u.name)                      AS user_name,
       sc.content,
       sc.is_hidden,
       sc.parent_id,
       sc.created_at,
       sc.updated_at,
       COALESCE(c.nome_fantasia, c.razao_social)            AS company_name
     FROM story_comments sc
     LEFT JOIN users    u ON u.id = sc.user_id
     LEFT JOIN companies c ON c.id = sc.company_id
     WHERE sc.story_id = $1
       AND sc.is_hidden = false
       AND sc.parent_id IS NULL
     ORDER BY sc.created_at ASC`,
    [storyId],
  );
  return result.rows;
};

const getCommentsForSupplier = async (storyId) => {
  const result = await pool.query(
    `SELECT
       sc.id, sc.uuid, sc.story_id, sc.company_id,
       sc.user_id,
       COALESCE(sc.user_name, u.name)                      AS user_name,
       sc.content,
       sc.is_hidden,
       sc.parent_id,
       sc.created_at,
       sc.updated_at,
       COALESCE(c.nome_fantasia, c.razao_social)            AS company_name
     FROM story_comments sc
     LEFT JOIN users    u ON u.id = sc.user_id
     LEFT JOIN companies c ON c.id = sc.company_id
     WHERE sc.story_id = $1
     ORDER BY COALESCE(sc.parent_id, sc.id) ASC, sc.created_at ASC`,
    [storyId],
  );
  return result.rows;
};

const hideComment = async (commentId) => {
  const result = await pool.query(
    `UPDATE story_comments SET is_hidden = NOT is_hidden, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [commentId],
  );
  return result.rows[0] || null;
};

const deleteComment = async (commentId) => {
  const result = await pool.query(
    "DELETE FROM story_comments WHERE id = $1 RETURNING id",
    [commentId],
  );
  return result.rows[0] || null;
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

  const clicksByItem = await pool.query(
    `SELECT media_item_id, COUNT(*) as count
     FROM story_clicks WHERE story_id = $1
     GROUP BY media_item_id`,
    [storyId],
  );

  return {
    ...story,
    reactions_breakdown: reactionsBreakdown.rows,
    clicks_by_item: clicksByItem.rows,
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
  addMediaItem,
  removeMediaItem,
  reorderMediaItems,
  recordView,
  recordClick,
  recordReaction,
  addComment,
  getComments,
  getCommentsForSupplier,
  hideComment,
  deleteComment,
  getMetrics,
};
