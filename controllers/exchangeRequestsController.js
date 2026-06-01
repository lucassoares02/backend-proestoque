const service = require("../services/exchangeRequestsService");
const minio   = require("./minioController");

const _err = (res, e, code = 500) =>
  res.status(code).json({ success: false, data: null, error: e.message || String(e) });

const create = async (req, res) => {
  try {
    const { company_id, supplier_company_id, order_id, reason, notes, items, created_by } = req.body;
    if (!company_id || !supplier_company_id || !reason) {
      return _err(res, new Error("company_id, supplier_company_id e reason são obrigatórios"), 400);
    }
    const parsedItems = Array.isArray(items) ? items : [];
    const data = await service.create({
      companyId: parseInt(company_id),
      supplierCompanyId: parseInt(supplier_company_id),
      orderId: order_id ? parseInt(order_id) : null,
      reason,
      notes: notes || null,
      items: parsedItems.map(i => {
        // Aceita camelCase (Flutter) e snake_case para não perder o vínculo do produto.
        const productId = i.productId ?? i.product_id;
        const variantId = i.variantId ?? i.variant_id;
        return {
          productId:      productId != null && `${productId}` !== "" ? parseInt(productId) : null,
          variantId:      variantId != null && `${variantId}` !== "" ? parseInt(variantId) : null,
          product_name:   i.product_name ?? i.productName ?? null,
          ean:            i.ean             || null,
          batch:          i.batch           || null,
          expirationDate: i.expiration_date ?? i.expirationDate ?? null,
          quantity:       i.quantity        ? parseInt(i.quantity)    : 1,
          notes:          i.notes          || null,
        };
      }),
      createdBy: created_by ? parseInt(created_by) : null,
    });
    return res.status(201).json({ success: true, data, error: null });
  } catch (e) {
    console.error("[exchangeRequests] create error:", e.message);
    return _err(res, e);
  }
};

const listByBuyer = async (req, res) => {
  try {
    const { company_id, status } = req.query;
    if (!company_id) return _err(res, new Error("company_id é obrigatório"), 400);
    const data = await service.listByBuyer(parseInt(company_id), { status });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("[exchangeRequests] listByBuyer error:", e.message);
    return _err(res, e);
  }
};

const findByBuyer = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { company_id } = req.query;
    if (!company_id) return _err(res, new Error("company_id é obrigatório"), 400);
    const data = await service.findByUuid(uuid, { role: "buyer", id: parseInt(company_id) });
    if (!data) return _err(res, new Error("Não encontrado"), 404);
    return res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("[exchangeRequests] findByBuyer error:", e.message);
    return _err(res, e);
  }
};

const listBySupplier = async (req, res) => {
  try {
    const { supplier_company_id, status } = req.query;
    if (!supplier_company_id) return _err(res, new Error("supplier_company_id é obrigatório"), 400);
    const data = await service.listBySupplier(parseInt(supplier_company_id), { status });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("[exchangeRequests] listBySupplier error:", e.message);
    return _err(res, e);
  }
};

const findBySupplier = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { supplier_company_id } = req.query;
    if (!supplier_company_id) return _err(res, new Error("supplier_company_id é obrigatório"), 400);
    const data = await service.findByUuid(uuid, { role: "supplier", id: parseInt(supplier_company_id) });
    if (!data) return _err(res, new Error("Não encontrado"), 404);
    return res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("[exchangeRequests] findBySupplier error:", e.message);
    return _err(res, e);
  }
};

const approve = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { supplier_company_id, pickup_date, approved_by } = req.body;
    if (!supplier_company_id) return _err(res, new Error("supplier_company_id é obrigatório"), 400);
    const data = await service.approve({
      uuid,
      supplierId:  parseInt(supplier_company_id),
      pickupDate:  pickup_date  || null,
      approvedBy:  approved_by  ? parseInt(approved_by) : null,
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("[exchangeRequests] approve error:", e.message);
    return _err(res, e.message.includes("não encontrada") ? 404 : 400 ? e : e);
  }
};

const reject = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { supplier_company_id, rejected_reason, rejected_by } = req.body;
    if (!supplier_company_id || !rejected_reason) {
      return _err(res, new Error("supplier_company_id e rejected_reason são obrigatórios"), 400);
    }
    await service.reject({
      uuid,
      supplierId:      parseInt(supplier_company_id),
      rejectedReason:  rejected_reason,
      rejectedBy:      rejected_by ? parseInt(rejected_by) : null,
    });
    return res.json({ success: true, data: null, error: null });
  } catch (e) {
    console.error("[exchangeRequests] reject error:", e.message);
    return _err(res, e);
  }
};

const addFile = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { company_id, supplier_company_id } = req.body;
    const scope = company_id
      ? { role: "buyer",    id: parseInt(company_id) }
      : { role: "supplier", id: parseInt(supplier_company_id) };

    const row = await service.getIdByUuid(uuid);
    if (!row) return _err(res, new Error("Solicitação não encontrada"), 404);
    if (scope.role === "buyer"    && row.company_id          !== scope.id) return _err(res, new Error("Sem permissão"), 403);
    if (scope.role === "supplier" && row.supplier_company_id !== scope.id) return _err(res, new Error("Sem permissão"), 403);

    if (!req.file) return _err(res, new Error("Arquivo não enviado"), 400);
    const fileName = `proestoque/exchange-requests/${uuid}/${Date.now()}_${req.file.originalname}`;
    const { url } = await minio.uploadFile(req.file.buffer, fileName, req.file.mimetype);

    const file = await service.addFile({
      exchangeRequestId: row.id,
      fileUrl: url,
      fileType: req.file.mimetype,
      fileName: req.file.originalname,
    });
    return res.status(201).json({ success: true, data: file, error: null });
  } catch (e) {
    console.error("[exchangeRequests] addFile error:", e.message);
    return _err(res, e);
  }
};

module.exports = { create, listByBuyer, findByBuyer, listBySupplier, findBySupplier, approve, reject, addFile };
