const path = require("path");
const service = require("../services/orderAttachmentsService");
const minio = require("./minioController");

const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function _mime(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  return map[ext] || "application/octet-stream";
}

const uploadInvoice = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { supplier_id } = req.body;

    if (!req.file) return res.status(400).json({ success: false, data: null, error: "Nenhum arquivo enviado" });
    if (!supplier_id) return res.status(400).json({ success: false, data: null, error: "supplier_id obrigatório" });
    if (req.file.size > MAX_BYTES) return res.status(400).json({ success: false, data: null, error: "Arquivo muito grande (máx. 10 MB)" });

    const contentType = _mime(req.file.originalname);
    if (!ALLOWED_MIME.includes(contentType)) {
      return res.status(400).json({ success: false, data: null, error: "Tipo não permitido. Use PDF, JPG ou PNG." });
    }

    const order = await service.verifyOrderOwnership(uuid, parseInt(supplier_id));
    if (!order) return res.status(404).json({ success: false, data: null, error: "Pedido não encontrado" });
    if (order.status !== "APPROVED") {
      return res.status(422).json({ success: false, data: null, error: "Upload permitido apenas em pedidos aprovados" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileName = `proestoque/orders/${uuid}/invoice/${Date.now()}${ext}`;
    const { url } = await minio.uploadFile(req.file.buffer, fileName, contentType);
    const data = await service.saveInvoice(uuid, url, req.file.originalname);

    return res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("uploadInvoice:", e.message);
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const uploadBoleto = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { supplier_id } = req.body;

    if (!req.file) return res.status(400).json({ success: false, data: null, error: "Nenhum arquivo enviado" });
    if (!supplier_id) return res.status(400).json({ success: false, data: null, error: "supplier_id obrigatório" });
    if (req.file.size > MAX_BYTES) return res.status(400).json({ success: false, data: null, error: "Arquivo muito grande (máx. 10 MB)" });

    const contentType = _mime(req.file.originalname);
    if (!ALLOWED_MIME.includes(contentType)) {
      return res.status(400).json({ success: false, data: null, error: "Tipo não permitido. Use PDF, JPG ou PNG." });
    }

    const order = await service.verifyOrderOwnership(uuid, parseInt(supplier_id));
    if (!order) return res.status(404).json({ success: false, data: null, error: "Pedido não encontrado" });
    if (order.status !== "APPROVED") {
      return res.status(422).json({ success: false, data: null, error: "Upload permitido apenas em pedidos aprovados" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileName = `proestoque/orders/${uuid}/boleto/${Date.now()}${ext}`;
    const { url } = await minio.uploadFile(req.file.buffer, fileName, contentType);
    const data = await service.saveBoleto(uuid, url, req.file.originalname);

    return res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("uploadBoleto:", e.message);
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const deleteInvoice = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { supplier_id } = req.query;
    if (!supplier_id) return res.status(400).json({ success: false, data: null, error: "supplier_id obrigatório" });

    const order = await service.verifyOrderOwnership(uuid, parseInt(supplier_id));
    if (!order) return res.status(404).json({ success: false, data: null, error: "Pedido não encontrado" });

    await service.clearInvoice(uuid);
    return res.json({ success: true, data: null, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const deleteBoleto = async (req, res) => {
  try {
    const { uuid } = req.params;
    const { supplier_id } = req.query;
    if (!supplier_id) return res.status(400).json({ success: false, data: null, error: "supplier_id obrigatório" });

    const order = await service.verifyOrderOwnership(uuid, parseInt(supplier_id));
    if (!order) return res.status(404).json({ success: false, data: null, error: "Pedido não encontrado" });

    await service.clearBoleto(uuid);
    return res.json({ success: true, data: null, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

module.exports = { uploadInvoice, uploadBoleto, deleteInvoice, deleteBoleto };
