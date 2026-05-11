const supplierDashboardService = require("../services/supplierDashboardService");

const getDashboard = async (req, res) => {
  try {
    const supplierId = parseInt(req.params.supplier);
    if (!supplierId) return res.status(400).json({ success: false, data: null, error: "supplierId required" });
    const data = await supplierDashboardService.getDashboard(supplierId);
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

module.exports = { getDashboard };
