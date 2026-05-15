const service = require("../services/supportTicketsService");
const minio = require("./minioController");

const _err = (res, e, code = 500) =>
  res.status(code).json({ success: false, data: null, error: e.message || String(e) });

// ─── Cliente ──────────────────────────────────────────────────────────────────

const createTicket = async (req, res) => {
  try {
    const { company_id, supplier_id, customer_id, subject, category, priority, message } = req.body;
    if (!company_id || !supplier_id || !subject || !message) {
      return _err(res, new Error("company_id, supplier_id, subject e message são obrigatórios"), 400);
    }
    const data = await service.createTicket({
      companyId: parseInt(company_id),
      supplierId: parseInt(supplier_id),
      customerId: customer_id ? parseInt(customer_id) : null,
      subject, category, priority, message,
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e);
  }
};

const listByCustomer = async (req, res) => {
  try {
    const companyId = parseInt(req.params.company);
    if (!companyId) return _err(res, new Error("company inválido"), 400);
    const data = await service.listByCustomer(companyId, {
      status: req.query.status,
      priority: req.query.priority,
      search: req.query.search,
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e);
  }
};

const findByCustomer = async (req, res) => {
  try {
    const companyId = parseInt(req.params.company);
    const uuid = req.params.uuid;
    if (!companyId || !uuid) return _err(res, new Error("parâmetros inválidos"), 400);
    const data = await service.findTicket(uuid, { role: 'customer', id: companyId });
    if (!data) return res.status(404).json({ success: false, data: null, error: "Ticket não encontrado" });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e);
  }
};

const customerSendMessage = async (req, res) => {
  try {
    const uuid = req.params.uuid;
    const { company_id, customer_id, message } = req.body;
    if (!company_id || !uuid) {
      return _err(res, new Error("company_id e uuid são obrigatórios"), 400);
    }
    let attachments = null;
    const file = service.validateAttachment(req.file);
    if (file) {
      const fileName = `proestoque/support/${uuid}/${Date.now()}_${file.originalName}`;
      const { url } = await minio.uploadFile(file.buffer, fileName, file.mime);
      attachments = [{
        url,
        type: file.mime,
        name: file.originalName,
        size: file.size,
      }];
    }
    const data = await service.addMessage({
      uuid,
      senderType: 'CUSTOMER',
      senderUserId: customer_id || null,
      message,
      attachments,
      scope: { role: 'customer', id: parseInt(company_id) },
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e, e.message === 'Acesso negado' ? 403 : 400);
  }
};

const customerClose = async (req, res) => {
  try {
    const { company_id } = req.body;
    const uuid = req.params.uuid;
    const data = await service.closeTicket({
      uuid,
      scope: { role: 'customer', id: parseInt(company_id) },
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e, e.message === 'Acesso negado' ? 403 : 400);
  }
};

const customerReopen = async (req, res) => {
  try {
    const { company_id } = req.body;
    const uuid = req.params.uuid;
    const data = await service.reopenTicket({
      uuid,
      scope: { role: 'customer', id: parseInt(company_id) },
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e, e.message === 'Acesso negado' ? 403 : 400);
  }
};

// ─── Fornecedor ───────────────────────────────────────────────────────────────

const listBySupplier = async (req, res) => {
  try {
    const supplierId = parseInt(req.params.supplier);
    if (!supplierId) return _err(res, new Error("supplier inválido"), 400);
    const data = await service.listBySupplier(supplierId, {
      status: req.query.status,
      priority: req.query.priority,
      search: req.query.search,
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e);
  }
};

const findBySupplier = async (req, res) => {
  try {
    const supplierId = parseInt(req.params.supplier);
    const uuid = req.params.uuid;
    if (!supplierId || !uuid) return _err(res, new Error("parâmetros inválidos"), 400);
    const data = await service.findTicket(uuid, { role: 'supplier', id: supplierId });
    if (!data) return res.status(404).json({ success: false, data: null, error: "Ticket não encontrado" });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e);
  }
};

const supplierSendMessage = async (req, res) => {
  try {
    const uuid = req.params.uuid;
    const { supplier_id, sender_user_id, message } = req.body;
    if (!supplier_id || !uuid) {
      return _err(res, new Error("supplier_id e uuid são obrigatórios"), 400);
    }
    let attachments = null;
    const file = service.validateAttachment(req.file);
    if (file) {
      const fileName = `proestoque/support/${uuid}/${Date.now()}_${file.originalName}`;
      const { url } = await minio.uploadFile(file.buffer, fileName, file.mime);
      attachments = [{
        url,
        type: file.mime,
        name: file.originalName,
        size: file.size,
      }];
    }
    const data = await service.addMessage({
      uuid,
      senderType: 'SUPPLIER',
      senderUserId: sender_user_id || null,
      message,
      attachments,
      scope: { role: 'supplier', id: parseInt(supplier_id) },
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e, e.message === 'Acesso negado' ? 403 : 400);
  }
};

const supplierClose = async (req, res) => {
  try {
    const { supplier_id } = req.body;
    const uuid = req.params.uuid;
    const data = await service.closeTicket({
      uuid,
      scope: { role: 'supplier', id: parseInt(supplier_id) },
    });
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return _err(res, e, e.message === 'Acesso negado' ? 403 : 400);
  }
};

module.exports = {
  createTicket,
  listByCustomer,
  findByCustomer,
  customerSendMessage,
  customerClose,
  customerReopen,
  listBySupplier,
  findBySupplier,
  supplierSendMessage,
  supplierClose,
};
