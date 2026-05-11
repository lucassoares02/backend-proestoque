const service = require("../services/productVariantsService");

const findAll = async (req, res) => {
  const { id } = req.params;
  try {
    const data = await service.findByProduct(Number(id));
    return res.status(200).json({ success: true, data, error: null });
  } catch (err) {
    console.error("Error fetching variants:", err);
    return res.status(500).json({ success: false, data: null, error: "Failed to fetch variants" });
  }
};

const create = async (req, res) => {
  const { id } = req.params;
  try {
    const variant = await service.create(Number(id), req.body);
    return res.status(201).json({ success: true, data: variant, error: null });
  } catch (err) {
    const status = err.status || 500;
    console.error("Error creating variant:", err);
    return res.status(status).json({ success: false, data: null, error: err.message });
  }
};

const update = async (req, res) => {
  const { id, variantId } = req.params;
  try {
    const variant = await service.update(Number(id), Number(variantId), req.body);
    if (!variant) return res.status(404).json({ success: false, data: null, error: "Variant not found" });
    return res.status(200).json({ success: true, data: variant, error: null });
  } catch (err) {
    const status = err.status || 500;
    console.error("Error updating variant:", err);
    return res.status(status).json({ success: false, data: null, error: err.message });
  }
};

const remove = async (req, res) => {
  const { id, variantId } = req.params;
  try {
    const variant = await service.remove(Number(id), Number(variantId));
    if (!variant) return res.status(404).json({ success: false, data: null, error: "Variant not found" });
    return res.status(200).json({ success: true, data: variant, error: null });
  } catch (err) {
    console.error("Error removing variant:", err);
    return res.status(500).json({ success: false, data: null, error: "Failed to remove variant" });
  }
};

module.exports = { findAll, create, update, remove };
