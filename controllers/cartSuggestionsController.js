const service = require("../services/cartSuggestionsService");

const getSuggestions = async (req, res) => {
  try {
    const { supplierId, cartItems } = req.body;
    if (!supplierId) {
      return res
        .status(400)
        .json({ success: false, error: "supplierId obrigatório", data: null });
    }
    const data = await service.getSuggestions(supplierId, cartItems || []);
    res.json({ success: true, data, error: null });
  } catch (e) {
    console.error("ERRO getSuggestions:", e);
    res.status(500).json({ success: false, error: e.message, data: null });
  }
};

module.exports = { getSuggestions };
