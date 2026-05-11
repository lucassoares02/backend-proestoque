const express = require("express");
const router = express.Router();
const multer = require("multer");

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
const files = require("../controllers/filesController");
const brands = require("../controllers/brandsController");
const buyTogether = require("../controllers/buyTogetherController");
const cartSuggestions = require("../controllers/cartSuggestionsController");
const supplierOrders = require("../controllers/supplierOrdersController");
const supplierDashboard = require("../controllers/supplierDashboardController");
const buyerDashboard = require("../controllers/buyerDashboardController");
const support = require("../controllers/supportTicketsController");
const paymentSettings = require("../controllers/paymentSettingsController");
const checkoutPayment = require("../controllers/checkoutPaymentController");
const productVariants = require("../controllers/productVariantsController");

const upload = multer({ storage: multer.memoryStorage() });

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
router.get("/products/company/:supplier/:company/:category", products.findAll);
router.post("/products", products.create);
router.patch("/products", products.update);
router.delete("/products/:id", products.remove);

//product variants — declaradas antes da wildcard /:id/:client para evitar conflito de rota
router.get("/products/:id/variants", productVariants.findAll);
router.post("/products/:id/variants", productVariants.create);
router.put("/products/:id/variants/:variantId", productVariants.update);
router.delete("/products/:id/variants/:variantId", productVariants.remove);

router.get("/products/:id/:client", products.find);

//categories
router.get("/categories", categories.findAll);
router.get("/categories/:id", categories.find);
router.get("/categories/supplier/:id", categories.findCategoriesSupplier);
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

//files
router.post("/files/upload", upload.single("file"), files.upload);

//brands
router.get("/brands/company/:company", brands.findAll);
router.get("/brands/:id", brands.find);
router.post("/brands", brands.create);
router.patch("/brands/:id", brands.update);
router.delete("/brands/:id", brands.remove);

//buy-together
router.get("/buy-together/company/:company", buyTogether.findAll);
router.get("/buy-together/products/:company", buyTogether.getProducts);
router.post("/buy-together/validate", buyTogether.validateCart);
router.get("/buy-together/:id", buyTogether.find);
router.post("/buy-together", buyTogether.create);
router.patch("/buy-together/:id", buyTogether.update);
router.delete("/buy-together/:id", buyTogether.remove);

//cart suggestions
router.post("/cart/suggestions", cartSuggestions.getSuggestions);

//supplier orders
router.get("/supplier-orders/:supplier", supplierOrders.findAll);
router.get("/supplier-orders/:supplier/:uuid", supplierOrders.find);
router.post("/supplier-orders/:supplier/:uuid/review", supplierOrders.review);

//supplier dashboard
router.get("/supplier/dashboard/:supplier", supplierDashboard.getDashboard);

//buyer dashboard
router.get("/buyer/dashboard/:company", buyerDashboard.getDashboard);

//support tickets — cliente
router.post("/support/tickets",                             support.createTicket);
router.get ("/support/tickets/:company",                    support.listByCustomer);
router.get ("/support/tickets/:company/:uuid",              support.findByCustomer);
router.post("/support/tickets/:uuid/messages",              support.customerSendMessage);
router.post("/support/tickets/:uuid/close",                 support.customerClose);
router.post("/support/tickets/:uuid/reopen",                support.customerReopen);

//support tickets — fornecedor
router.get ("/supplier/support/tickets/:supplier",          support.listBySupplier);
router.get ("/supplier/support/tickets/:supplier/:uuid",    support.findBySupplier);
router.post("/supplier/support/tickets/:uuid/messages",     support.supplierSendMessage);
router.post("/supplier/support/tickets/:uuid/close",        support.supplierClose);

//checkout payment options
router.get("/checkout/payment-options/:supplier/:company", checkoutPayment.paymentOptions);

//payment settings
router.get ("/payment-settings/resolve/:supplier/:customer",          paymentSettings.resolve);
router.get ("/payment-settings/:supplier",                            paymentSettings.getGeneral);
router.put ("/payment-settings/:supplier",                            paymentSettings.putGeneral);
router.get ("/payment-settings/:supplier/known-customers",            paymentSettings.listKnownCustomers);
router.get ("/payment-settings/:supplier/customers",                  paymentSettings.listCustomers);
router.get ("/payment-settings/:supplier/customers/:customer",        paymentSettings.getCustomer);
router.put ("/payment-settings/:supplier/customers/:customer",        paymentSettings.putCustomer);
router.delete("/payment-settings/:supplier/customers/:customer",      paymentSettings.deleteCustomer);

module.exports = router;
