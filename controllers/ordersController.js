const service = require("../services/ordersService");

/**
 * Get all Orders
 */
const findAll = async (req, res) => {
  const { company, status } = req.params;
  try {
    const data = await service.findAll(company, status);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Orders:", error);
    return res.status(500).json({ error: "Failed to fetch Orders" });
  }
};

/**
 * Get all Orders
 */
const findOrder = async (req, res) => {
  const { company, supplier } = req.params;
  try {
    const data = await service.findOrder(company, supplier);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching OrdersItem:", error);
    return res.status(500).json({ error: "Failed to fetch OrdersItem" });
  }
};

/**
 * Get Orders by ID
 */
const find = async (req, res) => {
  const { uuid } = req.params;
  console.log("UUID no controller:", uuid);
  if (!uuid) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(uuid);
    if (!item) return res.status(404).json({ error: "Orders not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching Orders by ID:", error);
    return res.status(500).json({ error: "Failed to fetch Orders" });
  }
};

/**
 * Create new Orders
 */
const create = async (req, res) => {
  const { uuid, payment_method, delivery_date, comment } = req.body;
  if (!uuid || Object.keys(uuid).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(uuid, payment_method, delivery_date, comment);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating Orders:", error);
    return res.status(500).json({ error: "Failed to create Orders" });
  }
};

/**
 * Update Orders
 */
const update = async (req, res) => {
  const { id } = req.params;
  const orders = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...orders, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Orders not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating Orders:", error);
    return res.status(500).json({ error: "Failed to update Orders" });
  }
};

/**
 * Delete Orders
 */
const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Orders not found" });
    return res.status(200).json({ message: "Orders deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting Orders:", error);
    return res.status(500).json({ error: "Failed to delete Orders" });
  }
};

module.exports = { findAll, find, create, update, remove, findOrder };
