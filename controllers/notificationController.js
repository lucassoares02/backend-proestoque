const svc = require("../services/notificationService");

const list = async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId);
    if (!companyId) return res.json({ success: false, data: null, error: "companyId required" });
    const data = await svc.listForCompany(companyId);
    res.json({ success: true, data, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const unreadCount = async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId);
    if (!companyId) return res.json({ success: true, data: { count: 0 }, error: null });
    const count = await svc.getUnreadCount(companyId);
    res.json({ success: true, data: { count }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const markRead = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = parseInt(req.body.companyId);
    if (!id || !companyId) return res.json({ success: false, data: null, error: "id and companyId required" });
    const row = await svc.markRead(id, companyId);
    res.json({ success: !!row, data: row, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const markAllRead = async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId);
    if (!companyId) return res.json({ success: false, data: null, error: "companyId required" });
    await svc.markAllRead(companyId);
    res.json({ success: true, data: null, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = parseInt(req.query.companyId || req.body?.companyId);
    if (!id || !companyId) return res.json({ success: false, data: null, error: "id and companyId required" });
    const row = await svc.remove(id, companyId);
    res.json({ success: !!row, data: row, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
};

const clearRead = async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId);
    if (!companyId) return res.json({ success: false, data: null, error: "companyId required" });
    await svc.clearRead(companyId);
    res.json({ success: true, data: null, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
};

module.exports = { list, unreadCount, markRead, markAllRead, remove, clearRead };
