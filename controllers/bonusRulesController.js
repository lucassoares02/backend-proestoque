const service = require("../services/bonusRulesService");

const findAll = async (req, res) => {
  const { company } = req.params;
  try {
    const data = await service.findAll(company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching bonus rules:", error);
    return res.status(500).json({ error: "Failed to fetch bonus rules" });
  }
};

const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ error: "Bonus rule not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching bonus rule:", error);
    return res.status(500).json({ error: "Failed to fetch bonus rule" });
  }
};

const findActiveBySupplier = async (req, res) => {
  const { supplier } = req.params;
  try {
    const data = await service.findActiveBySupplier(supplier);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching active bonus rules:", error);
    return res.status(500).json({ error: "Failed to fetch active bonus rules" });
  }
};

const findActiveByProduct = async (req, res) => {
  const { supplier, product } = req.params;
  try {
    const data = await service.findActiveByProduct(supplier, product);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching bonus rules for product:", error);
    return res.status(500).json({ error: "Failed to fetch bonus rules" });
  }
};

const getProducts = async (req, res) => {
  const { company } = req.params;
  try {
    const data = await service.getProducts(company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching products for bonus:", error);
    return res.status(500).json({ error: "Failed to fetch products" });
  }
};

const create = async (req, res) => {
  const body = req.body;
  if (!body || Object.keys(body).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(body);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating bonus rule:", error);
    return res.status(400).json({ error: error.message || "Failed to create bonus rule" });
  }
};

const update = async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  try {
    const updated = await service.update({ ...body, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Bonus rule not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating bonus rule:", error);
    return res.status(400).json({ error: error.message || "Failed to update bonus rule" });
  }
};

const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Bonus rule not found" });
    return res.status(200).json({ message: "Bonus rule deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting bonus rule:", error);
    return res.status(500).json({ error: "Failed to delete bonus rule" });
  }
};

module.exports = {
  findAll,
  find,
  findActiveBySupplier,
  findActiveByProduct,
  getProducts,
  create,
  update,
  remove,
};
