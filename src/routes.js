const express = require("express");
const router = express.Router();
const user = require("../controllers/userController");
const login = require("../controllers/loginController");
const authMiddleware = require("../src/middlewares/middleware");
const mailer = require("../controllers/maillerController");
const register = require("../controllers/registerController");
const companies = require("../controllers/companiesController");
const account = require("../controllers/accountController");
const products = require("../controllers/productsController");
const categories = require("../controllers/categoriesController");
const packages = require("../controllers/packagesController");
const routes = require("../controllers/routesController");
const orders = require("../controllers/ordersController");
const orders_item = require("../controllers/orders_itemController");
const coupons = require("../controllers/couponsController");

router.get("/", (req, res) => {
  res.send("API is running 🚀");
});

router.post("/signin", login.signin);

// USER
router.get("/users", authMiddleware, user.getAllUsers);
router.post("/users", user.createUser);

// SEND EMAIL
router.post("/send-email", mailer.sendEmail);

router.post("/register", register.create);
router.post("/companies/withoutid", authMiddleware, register.createCompaniesWithoutId);
router.post("/companies", register.createCompanies);
router.get("/cnpj/:cnpj", register.find);

router.get("/companies", authMiddleware, companies.find);
router.patch("/companies", authMiddleware, companies.update);
router.get("/companies/:company", authMiddleware, companies.findId);
router.get("/providers/city/:company", authMiddleware, companies.findProvidersCity);

router.get("/account", authMiddleware, account.find);
router.patch("/account", authMiddleware, account.update);

//products
router.get("/products/company/:supplier/:company", products.findAll);
router.get("/products/:id/:client", products.find);
router.post("/products", products.create);
router.patch("/products/:id", products.update);
router.delete("/products/:id", products.remove);

//categories
router.get("/categories", categories.findAll);
router.get("/categories/:id", categories.find);
router.post("/categories", categories.create);
router.patch("/categories/:id", categories.update);
router.delete("/categories/:id", categories.remove);

//packages
router.get("/packages", packages.findAll);
router.get("/packages/product/:id", packages.findPackagesProduct);
router.get("/packages/:id", packages.find);
router.post("/packages", packages.create);
router.patch("/packages/:id", packages.update);
router.delete("/packages/:id", packages.remove);

//routes
router.get("/routes/:state/:company", routes.findAll);
router.get("/ibge/states", routes.findAllStates);
router.get("/ibge/routes/cities/:stateId", routes.findAllCities);
router.get("/available/routes/cities/:supplier/:company", routes.findAllAvailableRoutes);
router.get("/states/routes/:company", routes.findStatesSelected);
router.get("/routes/:id", routes.find);
router.post("/routes", routes.create);
router.patch("/routes/:id", routes.update);
router.delete("/routes/:id", routes.remove);

//orders
router.get("/orders/company/:status/:company", orders.findAll);
router.get("/orders/company/supplier/:company/:supplier", orders.findOrder);
router.get("/orders/:uuid", orders.find);
router.post("/orders", orders.create);
router.patch("/orders/:id", orders.update);
router.delete("/orders/:id", orders.remove);

//orders_item
router.get("/orders-item", orders_item.findAll);
router.get("/orders-item/:id", orders_item.find);
router.get("/count/orders-items/:company", orders_item.countOrdersItems);
router.post("/orders-item", orders_item.create);
router.patch("/orders-item/:id", orders_item.update);
router.delete("/orders-item/:id", orders_item.remove);

//coupons
router.get("/coupons", coupons.findAll);
router.get("/coupons/:id", coupons.find);
router.post("/coupons", coupons.create);
router.patch("/coupons/:id", coupons.update);
router.delete("/coupons/:id", coupons.remove);

module.exports = router;
