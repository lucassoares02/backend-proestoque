const buyerDashboardService = require("../services/buyerDashboardService");

const getDashboard = async (req, res) => {
  try {
    const companyId = parseInt(req.params.company);
    if (!companyId) {
      return res.status(400).json({ success: false, data: null, error: "companyId required" });
    }
    const data = await buyerDashboardService.getDashboard(companyId);
    return res.json({ success: true, data, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

module.exports = { getDashboard };
