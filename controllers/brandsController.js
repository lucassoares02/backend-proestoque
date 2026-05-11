const service = require("../services/brandsService");

/**
 * Get all Brands
 */
const findAll = async (req, res) => {
  const { company } = req.params;
  try {
    const data = await service.findAll(company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Brands:", error);
    return res.status(500).json({ error: "Failed to fetch Brands" });
  }
};

/**
 * Get Brands by ID
 */
const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ error: "Brands not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching Brands by ID:", error);
    return res.status(500).json({ error: "Failed to fetch Brands" });
  }
};

/**
 * Create new Brands
 */
const create = async (req, res) => {
  const brands = req.body;
  if (!brands || Object.keys(brands).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(brands);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating Brands:", error);
    return res.status(500).json({ error: "Failed to create Brands" });
  }
};

/**
 * Update Brands
 */
const update = async (req, res) => {
  const { id } = req.params;
  const brands = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...brands, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Brands not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating Brands:", error);
    return res.status(500).json({ error: "Failed to update Brands" });
  }
};

/**
 * Delete Brands
 */
const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Brands not found" });
    return res.status(200).json({ message: "Brands deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting Brands:", error);
    return res.status(500).json({ error: "Failed to delete Brands" });
  }
};

module.exports = { findAll, find, create, update, remove };
