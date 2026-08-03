const service = require("../services/clientsService");

const list = async (req, res) => {
  try {
    const { supplierId } = req.params;
    if (!supplierId) {
      return res.status(400).json({ success: false, message: "supplierId obrigatório" });
    }

    const data = await service.listClients(parseInt(supplierId));
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[clientsController] list error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

module.exports = { list };
