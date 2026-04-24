const service = require("../services/routesService");

/**
 * Get all Routes
 */
const findAll = async (req, res) => {
  const { state, company } = req.params;
  try {
    const data = await service.findAll(state, company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Routes:", error);
    return res.status(500).json({ error: "Failed to fetch Routes" });
  }
};

/**
 * Get Routes by ID
 */
const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ error: "Routes not found" });
    return res.status(200).json(item);
  } catch (error) {
    console.error("Error fetching Routes by ID:", error);
    return res.status(500).json({ error: "Failed to fetch Routes" });
  }
};

/**
 * Create new Routes
 */
const create = async (req, res) => {
  const routes = req.body;
  if (!routes || Object.keys(routes).length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  try {
    const newItem = await service.create(routes);
    return res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating Routes:", error);
    return res.status(500).json({ error: "Failed to create Routes" });
  }
};

/**
 * Update Routes
 */
const update = async (req, res) => {
  const { id } = req.params;
  const routes = req.body;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const updated = await service.update({ ...routes, id: parseInt(id) });
    if (!updated) return res.status(404).json({ error: "Routes not found" });
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating Routes:", error);
    return res.status(500).json({ error: "Failed to update Routes" });
  }
};

/**
 * Delete Routes
 */
const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ error: "Routes not found" });
    return res.status(200).json({ message: "Routes deleted", data: deleted });
  } catch (error) {
    console.error("Error deleting Routes:", error);
    return res.status(500).json({ error: "Failed to delete Routes" });
  }
};

/**
 * Get all Routes
 */
const findAllStates = async (req, res) => {
  try {
    const data = await service.findAllStates();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Routes:", error);
    return res.status(500).json({ error: "Failed to fetch Routes" });
  }
};

/**
 * Get all Cities by State ID
 */
const findAllCities = async (req, res) => {
  try {
    const { stateId } = req.params;
    const data = await service.findAllCities(stateId);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Routes:", error);
    return res.status(500).json({ error: "Failed to fetch Routes" });
  }
};

/**
 * Get all Available Routes
 */
const findAllAvailableRoutes = async (req, res) => {
  try {
    const { supplier, company } = req.params;
    const data = await service.findAllAvailableRoutes(supplier, company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Available Routes:", error);
    return res.status(500).json({ error: "Failed to fetch Routes" });
  }
};

/**
 * Get all States by State ID Company
 */
const findStatesSelected = async (req, res) => {
  console.log("Garantia");
  try {
    const { company } = req.params;
    const data = await service.findStatesSelected(company);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching Routes:", error);
    return res.status(500).json({ error: "Failed to fetch Routes" });
  }
};

module.exports = { findAll, find, create, update, remove, findAllStates, findAllCities, findStatesSelected, findAllAvailableRoutes };
