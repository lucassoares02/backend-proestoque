const pool = require("../db");
const path = require("path");

const VALID_STATUS = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SUPPLIER', 'CLOSED'];
const VALID_PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const VALID_CATEGORIES = ['pedido', 'entrega', 'financeiro', 'produto', 'comercial', 'outro'];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

const _ticketSelect = `
  t.id, t.public_id AS uuid, t.company_id, t.supplier_id, t.customer_id,
  t.subject, t.category, t.priority, t.status,
  t.last_message_at, t.closed_at, t.created_at, t.updated_at,
  COALESCE(NULLIF(c.nome_fantasia, ''), c.razao_social) AS customer_name,
  COALESCE(NULLIF(s.nome_fantasia, ''), s.razao_social) AS supplier_name,
  s.logo AS supplier_logo,
  (SELECT COUNT(*) FROM support_ticket_messages m
    WHERE m.ticket_id = t.id) AS message_count,
  (SELECT m.message FROM support_ticket_messages m
    WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview
`;

const createTicket = async ({ companyId, supplierId, customerId, subject, category, priority, message }) => {
  if (!companyId || !supplierId || !subject || !message) {
    throw new Error("companyId, supplierId, subject e message são obrigatórios");
  }
  const cat = VALID_CATEGORIES.includes(category) ? category : 'outro';
  const pri = VALID_PRIORITY.includes(priority) ? priority : 'NORMAL';

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tRes = await client.query(
      `INSERT INTO support_tickets
         (company_id, supplier_id, customer_id, subject, category, priority, status, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'WAITING_SUPPLIER', NOW())
       RETURNING id, public_id`,
      [companyId, supplierId, customerId || null, subject, cat, pri],
    );
    const ticketId = tRes.rows[0].id;
    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_user_id, sender_type, message)
       VALUES ($1, $2, 'CUSTOMER', $3)`,
      [ticketId, customerId || null, message],
    );
    await client.query("COMMIT");
    return { id: ticketId, uuid: tRes.rows[0].public_id };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const _buildFilters = (filters = {}) => {
  const clauses = [];
  const params = [];
  if (filters.status && VALID_STATUS.includes(filters.status)) {
    params.push(filters.status);
    clauses.push(`t.status = $${params.length}`);
  }
  if (filters.priority && VALID_PRIORITY.includes(filters.priority)) {
    params.push(filters.priority);
    clauses.push(`t.priority = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(t.subject ILIKE $${params.length} OR t.category ILIKE $${params.length})`);
  }
  return { clauses, params };
};

const listByCustomer = async (companyId, filters = {}) => {
  const { clauses, params } = _buildFilters(filters);
  const allClauses = [`t.company_id = $1`, ...clauses];
  const sql = `
    SELECT ${_ticketSelect}
    FROM support_tickets t
    LEFT JOIN companies c ON c.id = t.company_id
    LEFT JOIN companies s ON s.id = t.supplier_id
    WHERE ${allClauses.join(' AND ')}
    ORDER BY t.last_message_at DESC
    LIMIT 200
  `;
  const { rows } = await pool.query(sql, [companyId, ...params]);
  return rows;
};

const listBySupplier = async (supplierId, filters = {}) => {
  const { clauses, params } = _buildFilters(filters);
  const allClauses = [`t.supplier_id = $1`, ...clauses];
  const sql = `
    SELECT ${_ticketSelect}
    FROM support_tickets t
    LEFT JOIN companies c ON c.id = t.company_id
    LEFT JOIN companies s ON s.id = t.supplier_id
    WHERE ${allClauses.join(' AND ')}
    ORDER BY
      CASE t.priority
        WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2
        WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 ELSE 5
      END,
      t.last_message_at DESC
    LIMIT 200
  `;
  const { rows } = await pool.query(sql, [supplierId, ...params]);
  return rows;
};

const findTicket = async (uuid, scope) => {
  const tSql = `
    SELECT ${_ticketSelect}
    FROM support_tickets t
    LEFT JOIN companies c ON c.id = t.company_id
    LEFT JOIN companies s ON s.id = t.supplier_id
    WHERE t.public_id = $1
      AND (
        ($2::text = 'customer' AND t.company_id  = $3::int) OR
        ($2::text = 'supplier' AND t.supplier_id = $3::int)
      )
    LIMIT 1
  `;
  const { rows: tRows } = await pool.query(tSql, [uuid, scope.role, scope.id]);
  if (!tRows.length) return null;
  const ticket = tRows[0];

  const mSql = `
    SELECT m.id, m.ticket_id, m.sender_user_id, m.sender_type,
           m.message, m.attachments, m.read_at, m.created_at,
           u.name AS sender_name
    FROM support_ticket_messages m
    LEFT JOIN users u ON u.id = m.sender_user_id
    WHERE m.ticket_id = $1
    ORDER BY m.created_at ASC
  `;
  const { rows: mRows } = await pool.query(mSql, [ticket.id]);
  ticket.messages = mRows;
  return ticket;
};

const _bufferLooksValid = (buffer, ext) => {
  if (!buffer || !buffer.length) return false;
  const b = buffer;
  if (ext === '.pdf') return b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  if (ext === '.jpg' || ext === '.jpeg') return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === '.png') return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === '.webp') return b.length >= 12
    && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return false;
};

const validateAttachment = (file) => {
  if (!file) return null;
  if (!file.buffer || !file.size || file.size <= 0) {
    throw new Error("Arquivo inválido ou corrompido");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Arquivo muito grande (máx. 10 MB)");
  }
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME.includes(mime)) {
    throw new Error("Tipo não permitido. Envie JPG, JPEG, PNG, WEBP ou PDF.");
  }
  if (!_bufferLooksValid(file.buffer, ext)) {
    throw new Error("Arquivo inválido ou corrompido");
  }
  return {
    ext,
    mime,
    originalName: file.originalname || `anexo${ext}`,
    size: file.size,
    buffer: file.buffer,
  };
};

const addMessage = async ({ uuid, senderType, senderUserId, message, attachments = null, scope }) => {
  const text = (message || '').toString().trim();
  if (!text && (!attachments || !attachments.length)) {
    throw new Error("Mensagem vazia");
  }
  if (!['CUSTOMER', 'SUPPLIER'].includes(senderType)) {
    throw new Error("senderType inválido");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tRes = await client.query(
      `SELECT id, status, company_id, supplier_id
         FROM support_tickets
        WHERE public_id = $1 FOR UPDATE`,
      [uuid],
    );
    if (!tRes.rows.length) throw new Error("Ticket não encontrado");
    const ticket = tRes.rows[0];

    if (scope.role === 'customer' && ticket.company_id !== scope.id) {
      throw new Error("Acesso negado");
    }
    if (scope.role === 'supplier' && ticket.supplier_id !== scope.id) {
      throw new Error("Acesso negado");
    }
    if (ticket.status === 'CLOSED') {
      throw new Error("Ticket fechado — não é possível responder");
    }

    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_user_id, sender_type, message, attachments)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [ticket.id, senderUserId || null, senderType, text, JSON.stringify(attachments || [])],
    );

    const newStatus = senderType === 'SUPPLIER' ? 'WAITING_CUSTOMER' : 'WAITING_SUPPLIER';
    await client.query(
      `UPDATE support_tickets
         SET status = $2, last_message_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [ticket.id, newStatus],
    );

    await client.query("COMMIT");
    return { ticket_id: ticket.id, status: newStatus };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const closeTicket = async ({ uuid, scope }) => {
  const tRes = await pool.query(
    `SELECT id, company_id, supplier_id, status
       FROM support_tickets WHERE public_id = $1`,
    [uuid],
  );
  if (!tRes.rows.length) throw new Error("Ticket não encontrado");
  const ticket = tRes.rows[0];
  if (scope.role === 'customer' && ticket.company_id !== scope.id) {
    throw new Error("Acesso negado");
  }
  if (scope.role === 'supplier' && ticket.supplier_id !== scope.id) {
    throw new Error("Acesso negado");
  }
  if (ticket.status === 'CLOSED') return { id: ticket.id, status: 'CLOSED' };
  await pool.query(
    `UPDATE support_tickets
       SET status = 'CLOSED', closed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [ticket.id],
  );
  return { id: ticket.id, status: 'CLOSED' };
};

const reopenTicket = async ({ uuid, scope }) => {
  const tRes = await pool.query(
    `SELECT id, company_id, supplier_id, status
       FROM support_tickets WHERE public_id = $1`,
    [uuid],
  );
  if (!tRes.rows.length) throw new Error("Ticket não encontrado");
  const ticket = tRes.rows[0];
  if (scope.role === 'customer' && ticket.company_id !== scope.id) {
    throw new Error("Acesso negado");
  }
  if (scope.role === 'supplier' && ticket.supplier_id !== scope.id) {
    throw new Error("Acesso negado");
  }
  await pool.query(
    `UPDATE support_tickets
       SET status = 'WAITING_SUPPLIER', closed_at = NULL, updated_at = NOW(), last_message_at = NOW()
     WHERE id = $1`,
    [ticket.id],
  );
  return { id: ticket.id, status: 'WAITING_SUPPLIER' };
};

module.exports = {
  createTicket,
  listByCustomer,
  listBySupplier,
  findTicket,
  addMessage,
  validateAttachment,
  closeTicket,
  reopenTicket,
};
