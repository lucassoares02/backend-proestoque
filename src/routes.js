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
const orderAttachments = require("../controllers/orderAttachmentsController");
const productsImport = require("../controllers/productsImportController");
const campaigns = require("../controllers/campaignsController");
const productSales = require("../controllers/productSalesController");
const stories = require("../controllers/storyController");
const notifications = require("../controllers/notificationController");

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

//product import (bulk)
router.post("/products/import", productsImport.importBatch);

//product variants — declaradas antes da wildcard /:id/:client para evitar conflito de rota
router.get("/products/:id/variants", productVariants.findAll);
router.get("/products/:id/price-tiers", productVariants.getPriceTiers);
router.get("/products/:id/variant-overrides-count", productVariants.getOverrideCount);
router.post("/products/:id/variants", productVariants.create);
router.post("/products/:id/sync-variant-prices", productVariants.syncVariantPrices);
router.put("/products/:id/variants/:variantId", productVariants.update);
router.delete("/products/:id/variants/:variantId", productVariants.remove);

router.get("/products/:id/sales-history", productSales.getSalesHistory);
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

//order attachments (nota fiscal / boleto) — upload exclusivo do fornecedor
router.post("/orders/:uuid/invoice", upload.single("file"), orderAttachments.uploadInvoice);
router.post("/orders/:uuid/boleto",  upload.single("file"), orderAttachments.uploadBoleto);
router.delete("/orders/:uuid/invoice", orderAttachments.deleteInvoice);
router.delete("/orders/:uuid/boleto",  orderAttachments.deleteBoleto);

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
router.post("/support/tickets/:uuid/messages",              upload.single("file"), support.customerSendMessage);
router.post("/support/tickets/:uuid/close",                 support.customerClose);
router.post("/support/tickets/:uuid/reopen",                support.customerReopen);

//support tickets — fornecedor
router.get ("/supplier/support/tickets/:supplier",          support.listBySupplier);
router.get ("/supplier/support/tickets/:supplier/:uuid",    support.findBySupplier);
router.post("/supplier/support/tickets/:uuid/messages",     upload.single("file"), support.supplierSendMessage);
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

//campaigns
router.get("/campaigns/company/:companyId",        campaigns.findAll);
router.get("/campaigns/active/:companyId",         campaigns.findActive);
router.get("/campaigns/:id/metrics",               campaigns.getMetrics);
router.post("/campaigns/:id/view",                 campaigns.registerView);
router.post("/campaigns/:id/click",                campaigns.registerClick);
router.patch("/campaigns/:id/toggle",              campaigns.toggle);
router.get("/campaigns/:id",                       campaigns.find);
router.post("/campaigns",                          campaigns.create);
router.put("/campaigns/:id",                       campaigns.update);
router.delete("/campaigns/:id",                    campaigns.remove);

//stories
router.get("/stories/supplier/:companyId",           stories.findAllBySupplier);
router.get("/stories/active/:companyId",             stories.findActive);
router.get("/stories/:id/metrics",                   stories.getMetrics);
router.get("/stories/:id/comments",                  stories.getComments);
router.get("/stories/:id/comments/supplier",         stories.getCommentsForSupplier);
router.post("/stories/:id/view",                     stories.recordView);
router.post("/stories/:id/click",                    stories.recordClick);
router.post("/stories/:id/react",                    stories.recordReaction);
router.post("/stories/:id/comment",                  stories.addComment);
router.patch("/stories/:id/toggle",                  stories.toggle);
router.patch("/stories/comments/:commentId/hide",    stories.hideComment);
router.delete("/stories/comments/:commentId",        stories.deleteComment);
router.post("/stories/:id/media-items",              stories.addMediaItem);
router.patch("/stories/:id/media-items/reorder",     stories.reorderMediaItems);
router.delete("/stories/media-items/:itemId",        stories.removeMediaItem);
router.get("/stories/:id",                           stories.find);
router.post("/stories",                              stories.create);
router.put("/stories/:id",                           stories.update);
router.delete("/stories/:id",                        stories.remove);

//notifications
router.get("/notifications",                        notifications.list);
router.get("/notifications/unread-count",           notifications.unreadCount);
router.patch("/notifications/read-all",             notifications.markAllRead);
router.patch("/notifications/:id/read",             notifications.markRead);
router.post("/notifications/clear-read",            notifications.clearRead);
router.delete("/notifications/:id",                 notifications.remove);

module.exports = router;
