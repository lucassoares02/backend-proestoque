const service = require("../services/productSalesService");

const getSalesHistory = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    if (!productId || isNaN(productId)) {
      return res.status(400).json({ success: false, data: null, error: "Invalid product ID" });
    }
    const { period } = req.query;
    const data = await service.getSalesHistory(productId, period || "all");
    return res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("Error fetching sales history:", e);
    return res.status(500).json({ success: false, data: null, error: e.message });
  }
};

module.exports = { getSalesHistory };
