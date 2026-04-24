const service = require("../services/packagesService");

/**
 * Get all Packages
 */
const findAll = async (req, res) => {
  try {
    const data = await service.findAll();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Packages:", error);
    return res.status(500).json({ error: "Failed to fetch Packages" });
  }
};

/**
 * Get Packages by ID
 */
const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ error: "Packages not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching Packages by ID:", error);
    return res.status(500).json({ error: "Failed to fetch Packages" });
  }
};

/**
 * Get Packages by ID
 */
const findPackagesProduct = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.findPackagesProduct(id);
    if (!item) return res.status(404).json({ error: "Packages not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching Packages by ID:", error);
    return res.status(500).json({ error: "Failed to fetch Packages" });
  }
};

/**
 * Create new Packages
 */
const create = async (req, res) => {
  const packages = req.body;
  if (!packages || Object.keys(packages).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(packages);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating Packages:", error);
    return res.status(500).json({ error: "Failed to create Packages" });
  }
};

/**
 * Update Packages
 */
const update = async (req, res) => {
  const { id } = req.params;
  const packages = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...packages, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Packages not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating Packages:", error);
    return res.status(500).json({ error: "Failed to update Packages" });
  }
};

/**
 * Delete Packages
 */
const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Packages not found" });
    return res.status(200).json({ message: "Packages deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting Packages:", error);
    return res.status(500).json({ error: "Failed to delete Packages" });
  }
};

module.exports = { findAll, find, create, update, remove, findPackagesProduct };
