const service = require("../services/productsImportService");

const importBatch = async (req, res) => {
  const { products, companyId } = req.body;

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ success: false, error: "Nenhum produto enviado" });
  }

  if (!companyId) {
    return res.status(400).json({ success: false, error: "companyId é obrigatório" });
  }

  try {
    const { success_items, failed_items } = await service.importProducts({
      products,
      companyId: parseInt(companyId, 10),
    });

    return res.status(200).json({
      success: true,
      data: {
        success_items,
        failed_items,
        imported: success_items.length,
        failed: failed_items.length,
        total: products.length,
      },
    });
  } catch (err) {
    console.error("Error in batch import:", err);
    return res.status(500).json({ success: false, error: "Erro interno na importação" });
  }
};

module.exports = { importBatch };
