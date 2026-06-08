const service = require("../services/clientHomeService");
const productViews = require("../services/productViewsService");

// Helper para padronizar respostas de cada bloco da Home.
const block = (fn, label) => async (req, res) => {
  const company = parseInt(req.params.company, 10);
  if (!company) {
    return res.status(400).json({ success: false, error: "company inválido" });
  }
  try {
    const data = await fn(company);
    return res.json({ success: true, data });
  } catch (error) {
    console.error(`Error client-home ${label}:`, error);
    return res.status(500).json({ success: false, error: `Failed to load ${label}` });
  }
};

const stories = block(service.stories, "stories");
const campaigns = block(service.campaigns, "campaigns");
const suppliers = block(service.suppliers, "suppliers");
const brands = block(service.brands, "brands");
const recommended = block(service.recommended, "recommended");
const opportunities = block(service.opportunities, "opportunities");
const recentlyPurchased = block(service.recentlyPurchased, "recently-purchased");
const recentlyViewed = block(service.recentlyViewed, "recently-viewed");

const registerView = async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const { companyId, supplierId } = req.body || {};
  if (!productId || !companyId) {
    return res.status(400).json({ success: false, error: "productId e companyId são obrigatórios" });
  }
  try {
    await productViews.registerView(productId, companyId, supplierId);
    return res.json({ success: true });
  } catch (error) {
    console.error("Error registering product view:", error);
    return res.status(500).json({ success: false, error: "Failed to register view" });
  }
};

module.exports = {
  stories,
  campaigns,
  suppliers,
  brands,
  recommended,
  opportunities,
  recentlyPurchased,
  recentlyViewed,
  registerView,
};
