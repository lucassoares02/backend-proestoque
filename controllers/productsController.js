const service = require("../services/productsService");

/**
 * Get all Products
 */
const findAll = async (req, res) => {
  const { company, supplier } = req.params;
  try {
    const data = await service.findAll(supplier, company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Products:", error);
    return res.status(500).json({ error: "Failed to fetch Products" });
  }
};

/**
 * Get Products by ID
 */
const find = async (req, res) => {
  const { id, client } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(id, client);
    if (!item) return res.status(404).json({ error: "Products not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching Products by ID:", error);
    return res.status(500).json({ error: "Failed to fetch Products" });
    asdfasf;
  }
};

/**
 * Create new Products
 */
const create = async (req, res) => {
  const products = req.body;
  if (!products || Object.keys(products).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(products);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating Products:", error);
    return res.status(500).json({ error: "Failed to create Products" });
  }
};

/**
 * Update Products
 */
const update = async (req, res) => {
  const { id } = req.params;
  const products = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...products, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Products not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating Products:", error);
    return res.status(500).json({ error: "Failed to update Products" });
  }
};

/**
 * Delete Products
 */
const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Products not found" });
    return res.status(200).json({ message: "Products deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting Products:", error);
    return res.status(500).json({ error: "Failed to delete Products" });
  }
};

module.exports = { findAll, find, create, update, remove };
