const service = require("../services/buyTogetherService");

const findAll = async (req, res) => {
  const { company } = req.params;
  try {
    const data = await service.findAll(company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching BuyTogether campaigns:", error);
    return res.status(500).json({ error: "Failed to fetch campaigns" });
  }
};

const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ error: "Campaign not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching BuyTogether campaign:", error);
    return res.status(500).json({ error: "Failed to fetch campaign" });
  }
};

const getProducts = async (req, res) => {
  const { company } = req.params;
  try {
    const data = await service.getProducts(company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching products for BuyTogether:", error);
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
    console.error("Error creating BuyTogether campaign:", error);
    return res.status(400).json({ error: error.message || "Failed to create campaign" });
  }
};

const update = async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...body, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Campaign not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating BuyTogether campaign:", error);
    return res.status(400).json({ error: error.message || "Failed to update campaign" });
  }
};

const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Campaign not found" });
    return res.status(200).json({ message: "Campaign deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting BuyTogether campaign:", error);
    return res.status(500).json({ error: "Failed to delete campaign" });
  }
};

const validateCart = async (req, res) => {
  const { supplierId, cartItems } = req.body;
  if (!supplierId || !cartItems) {
    return res.status(400).json({ error: "supplierId and cartItems are required" });
  }
  try {
    const eligible = await service.validateCart(supplierId, cartItems);
    return res.status(200).json(eligible);
  } catch (error) {
    console.error("Error validating cart for BuyTogether:", error);
    return res.status(500).json({ error: "Failed to validate cart" });
  }
};

module.exports = { findAll, find, getProducts, create, update, remove, validateCart };
