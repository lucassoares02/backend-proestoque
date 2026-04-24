const service = require("../services/couponsService");

/**
 * Get all Coupons
 */
const findAll = async (req, res) => {
  try {
    const data = await service.findAll();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Coupons:", error);
    return res.status(500).json({ error: "Failed to fetch Coupons" });
  }
};

/**
 * Get Coupons by ID
 */
const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ error: "Coupons not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching Coupons by ID:", error);
    return res.status(500).json({ error: "Failed to fetch Coupons" });
  }
};

/**
 * Create new Coupons
 */
const create = async (req, res) => {
  const coupons = req.body;
  if (!coupons || Object.keys(coupons).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(coupons);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating Coupons:", error);
    return res.status(500).json({ error: "Failed to create Coupons" });
  }
};

/**
 * Update Coupons
 */
const update = async (req, res) => {
  const { id } = req.params;
  const coupons = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...coupons, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Coupons not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating Coupons:", error);
    return res.status(500).json({ error: "Failed to update Coupons" });
  }
};

/**
 * Delete Coupons
 */
const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Coupons not found" });
    return res.status(200).json({ message: "Coupons deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting Coupons:", error);
    return res.status(500).json({ error: "Failed to delete Coupons" });
  }
};

module.exports = { findAll, find, create, update, remove };
