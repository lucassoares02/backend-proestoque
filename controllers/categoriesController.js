const service = require("../services/categoriesService");

/**
 * Get all Categories
 */
const findAll = async (req, res) => {
  try {
    const data = await service.findAll();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Categories:", error);
    return res.status(500).json({ error: "Failed to fetch Categories" });
  }
};

/**
 * Get Categories by ID
 */
const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ error: "Categories not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching Categories by ID:", error);
    return res.status(500).json({ error: "Failed to fetch Categories" });
  }
};

/**
 * Create new Categories
 */
const create = async (req, res) => {
  const categories = req.body;
  if (!categories || Object.keys(categories).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(categories);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating Categories:", error);
    return res.status(500).json({ error: "Failed to create Categories" });
  }
};

/**
 * Update Categories
 */
const update = async (req, res) => {
  const { id } = req.params;
  const categories = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...categories, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Categories not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating Categories:", error);
    return res.status(500).json({ error: "Failed to update Categories" });
  }
};

/**
 * Delete Categories
 */
const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Categories not found" });
    return res.status(200).json({ message: "Categories deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting Categories:", error);
    return res.status(500).json({ error: "Failed to delete Categories" });
  }
};

module.exports = { findAll, find, create, update, remove };
