const service = require("../services/orders_itemService");

/**
 * Get all OrdersItem
 */
const findAll = async (req, res) => {
  try {
    const data = await service.findAll();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching OrdersItem:", error);
    return res.status(500).json({ error: "Failed to fetch OrdersItem" });
  }
};

/**
 * Get OrdersItem by ID
 */
const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ error: "OrdersItem not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching OrdersItem by ID:", error);
    return res.status(500).json({ error: "Failed to fetch OrdersItem" });
  }
};

/**
 * Get OrdersItem by ID
 */
const countOrdersItems = async (req, res) => {
  const { company } = req.params;
  if (!company || isNaN(company)) {
    return res.status(400).json({ error: "Invalid company" });
  }
  try {
    const item = await service.countOrdersItems(company);
    if (!item) return res.status(404).json({ error: "OrdersItem not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching OrdersItem by ID:", error);
    return res.status(500).json({ error: "Failed to fetch OrdersItem" });
  }
};

/**
 * Create new OrdersItem
 */
const create = async (req, res) => {
  const orders_item = req.body;
  if (!orders_item || Object.keys(orders_item).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(orders_item);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating OrdersItem:", error);
    return res.status(500).json({ error: "Failed to create OrdersItem" });
  }
};

/**
 * Update OrdersItem
 */
const update = async (req, res) => {
  const { id } = req.params;
  const orders_item = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...orders_item, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "OrdersItem not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating OrdersItem:", error);
    return res.status(500).json({ error: "Failed to update OrdersItem" });
  }
};

/**
 * Delete OrdersItem
 */
const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "OrdersItem not found" });
    return res.status(200).json({ message: "OrdersItem deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting OrdersItem:", error);
    return res.status(500).json({ error: "Failed to delete OrdersItem" });
  }
};

module.exports = { findAll, find, create, update, remove, countOrdersItems };
