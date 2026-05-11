const supplierOrdersService = require("../services/supplierOrdersService");

const findAll = async (req, res) => {
  try {
    const supplierId = parseInt(req.params.supplier);
    if (!supplierId) {
      return res.status(400).json({ success: false, data: null, error: "supplierId required" });
    }
    const { status } = req.query;
    const data = await supplierOrdersService.findAll(supplierId, status);
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const find = async (req, res) => {
  try {
    const supplierId = parseInt(req.params.supplier);
    const { uuid } = req.params;
    const data = await supplierOrdersService.find(uuid, supplierId);
    if (!data) {
      return res.status(404).json({ success: false, data: null, error: "Order not found" });
    }
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const review = async (req, res) => {
  try {
    const supplierId = parseInt(req.params.supplier);
    const { uuid } = req.params;
    const { action, comment } = req.body;
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ success: false, data: null, error: "action must be approve or reject" });
    }
    const data = await supplierOrdersService.review(uuid, supplierId, action, comment);
    return res.json({ success: true, data, error: null });
  } catch (e) {
    if (e.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ success: false, data: null, error: "Order not found" });
    }
    if (e.message === "ORDER_ALREADY_REVIEWED") {
      return res.status(409).json({ success: false, data: null, error: "Order already reviewed" });
    }
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

module.exports = { findAll, find, review };
