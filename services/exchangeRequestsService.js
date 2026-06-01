const pool = require("../db");
const notificationService = require("./notificationService");

const VALID_STATUS = ["pending", "approved", "rejected", "collect_scheduled", "collected", "finished"];

const _generateCode = async (client, prefix, seqName) => {
  const year = new Date().getFullYear();
  const r = await client.query(`SELECT NEXTVAL('${seqName}') AS n`);
  return `${prefix}-${year}-${String(r.rows[0].n).padStart(6, "0")}`;
};

const _requestSelect = `
  er.id, er.uuid, er.company_id, er.supplier_company_id, er.order_id,
  er.request_code, er.status, er.reason, er.notes,
  er.pickup_date, er.pickup_code, er.approved_by, er.approved_at,
  er.rejected_reason, er.created_by, er.created_at, er.updated_at,
  COALESCE(NULLIF(buyer.nome_fantasia,''), buyer.razao_social) AS company_name,
  COALESCE(NULLIF(sup.nome_fantasia,''),  sup.razao_social)   AS supplier_name,
  (SELECT COUNT(*) FROM exchange_request_items i WHERE i.exchange_request_id = er.id)::int AS items_count,
  (SELECT COUNT(*) FROM exchange_request_files f WHERE f.exchange_request_id = er.id)::int AS files_count
`;

const create = async ({ companyId, supplierCompanyId, orderId, reason, notes, items = [], createdBy }) => {
  if (!companyId || !supplierCompanyId || !reason) {
    throw new Error("companyId, supplierCompanyId e reason são obrigatórios");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const code = await _generateCode(client, "TRC", "exchange_request_code_seq");
    const r = await client.query(
      `INSERT INTO exchange_requests
         (company_id, supplier_company_id, order_id, request_code, status, reason, notes, created_by)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING id, uuid`,
      [companyId, supplierCompanyId, orderId || null, code, reason, notes || null, createdBy || null]
    );
    const { id, uuid } = r.rows[0];
    for (const item of items) {
      await client.query(
        `INSERT INTO exchange_request_items
           (exchange_request_id, product_id, variant_id, product_name, ean, batch, expiration_date, quantity, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, item.productId || null, item.variantId || null, item.product_name || null,
         item.ean || null, item.batch || null, item.expirationDate || null,
         item.quantity || 1, item.notes || null]
      );
    }
    await client.query("COMMIT");

    // Notify supplier
    notificationService.createNotification({
      companyId: supplierCompanyId,
      userType: 2,
      title: "Nova solicitação de troca/devolução",
      description: `Uma nova solicitação ${code} foi aberta e aguarda sua análise.`,
      notificationType: "exchange",
      entityType: "exchange_request",
      entityUuid: uuid,
    }).catch(() => {});

    return { id, uuid, requestCode: code };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const listByBuyer = async (companyId, { status } = {}) => {
  const params = [companyId];
  let filter = "";
  if (status && VALID_STATUS.includes(status)) {
    params.push(status);
    filter = `AND er.status = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT ${_requestSelect}
     FROM exchange_requests er
     JOIN companies buyer ON buyer.id = er.company_id
     JOIN companies sup   ON sup.id   = er.supplier_company_id
     WHERE er.company_id = $1 ${filter}
     ORDER BY er.created_at DESC`,
    params
  );
  return rows;
};

const listBySupplier = async (supplierId, { status } = {}) => {
  const params = [supplierId];
  let filter = "";
  if (status && VALID_STATUS.includes(status)) {
    params.push(status);
    filter = `AND er.status = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT ${_requestSelect}
     FROM exchange_requests er
     JOIN companies buyer ON buyer.id = er.company_id
     JOIN companies sup   ON sup.id   = er.supplier_company_id
     WHERE er.supplier_company_id = $1 ${filter}
     ORDER BY er.created_at DESC`,
    params
  );
  return rows;
};

const findByUuid = async (uuid, scope) => {
  const r = await pool.query(
    `SELECT ${_requestSelect}
     FROM exchange_requests er
     JOIN companies buyer ON buyer.id = er.company_id
     JOIN companies sup   ON sup.id   = er.supplier_company_id
     WHERE er.uuid = $1`,
    [uuid]
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  if (scope.role === "buyer"    && row.company_id           !== scope.id) return null;
  if (scope.role === "supplier" && row.supplier_company_id  !== scope.id) return null;

  const items = await pool.query(
    `SELECT i.*, COALESCE(i.product_name, p.name) AS product_name,
            pv.name AS variant_name, pv.sku AS variant_sku, pv.ean AS variant_ean,
            p.sku                AS product_sku,
            p.brand              AS brand,
            p.complement         AS complement,
            p.description        AS product_description,
            p.package_type       AS package_type,
            p.unit_of_measure    AS unit_of_measure,
            p.units_per_package  AS units_per_package,
            p.content            AS content,
            cat.name             AS category_name,
            COALESCE(pv.image_url, (
              SELECT pi.url FROM products_images pi WHERE pi.product_id = p.id
              ORDER BY pi.sort_order LIMIT 1
            )) AS product_image
     FROM exchange_request_items i
     LEFT JOIN products p        ON p.id  = i.product_id
     LEFT JOIN product_variants pv ON pv.id = i.variant_id
     LEFT JOIN products_categories cat ON cat.id = p.category_id
     WHERE i.exchange_request_id = $1
     ORDER BY i.id ASC`,
    [row.id]
  );
  const files = await pool.query(
    `SELECT * FROM exchange_request_files WHERE exchange_request_id = $1 ORDER BY id ASC`,
    [row.id]
  );

  return { ...row, items: items.rows, files: files.rows };
};

const approve = async ({ uuid, supplierId, pickupDate, approvedBy }) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT id, uuid, status, company_id, request_code FROM exchange_requests WHERE uuid = $1`,
      [uuid]
    );
    if (!r.rows[0]) throw new Error("Solicitação não encontrada");
    const req = r.rows[0];
    if (req.status !== "pending") throw new Error("Somente solicitações pendentes podem ser aprovadas");

    const pickupCode = await _generateCode(client, "COL", "exchange_pickup_code_seq");
    await client.query(
      `UPDATE exchange_requests
       SET status = 'approved', pickup_code = $1, pickup_date = $2,
           approved_by = $3, approved_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [pickupCode, pickupDate || null, approvedBy || null, req.id]
    );
    await client.query("COMMIT");

    notificationService.createNotification({
      companyId: req.company_id,
      userType: 1,
      title: "Solicitação de troca aprovada",
      description: `Sua solicitação ${req.request_code} foi aprovada. Código de coleta: ${pickupCode}`,
      notificationType: "exchange",
      entityType: "exchange_request",
      entityUuid: req.uuid,
    }).catch(() => {});

    return { pickupCode, pickupDate: pickupDate || null };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const reject = async ({ uuid, supplierId, rejectedReason, rejectedBy }) => {
  const r = await pool.query(
    `SELECT id, uuid, status, company_id, request_code FROM exchange_requests WHERE uuid = $1`,
    [uuid]
  );
  if (!r.rows[0]) throw new Error("Solicitação não encontrada");
  const req = r.rows[0];
  if (req.status !== "pending") throw new Error("Somente solicitações pendentes podem ser rejeitadas");
  if (!rejectedReason) throw new Error("Motivo de rejeição é obrigatório");

  await pool.query(
    `UPDATE exchange_requests
     SET status = 'rejected', rejected_reason = $1,
         approved_by = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $3`,
    [rejectedReason, rejectedBy || null, req.id]
  );

  notificationService.createNotification({
    companyId: req.company_id,
    userType: 1,
    title: "Solicitação de troca rejeitada",
    description: `Sua solicitação ${req.request_code} foi rejeitada. Motivo: ${rejectedReason}`,
    notificationType: "exchange",
    entityType: "exchange_request",
    entityUuid: req.uuid,
  }).catch(() => {});
};

const addFile = async ({ exchangeRequestId, fileUrl, fileType, fileName }) => {
  const { rows } = await pool.query(
    `INSERT INTO exchange_request_files (exchange_request_id, file_url, file_type, file_name)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [exchangeRequestId, fileUrl, fileType || null, fileName || null]
  );
  return rows[0];
};

const getIdByUuid = async (uuid) => {
  const r = await pool.query(`SELECT id, company_id, supplier_company_id FROM exchange_requests WHERE uuid = $1`, [uuid]);
  return r.rows[0] || null;
};

module.exports = { create, listByBuyer, listBySupplier, findByUuid, approve, reject, addFile, getIdByUuid };
