const { uploadFile } = require("./minioController");

const Files = {
  async upload(req, res) {
    console.log("Upload Provider Image");
    console.log(req.file);

    try {
      const ext = req.file.originalname.split(".").pop();
      const fileName = `proestoque/products/${req.file.originalname}/image.${ext}`;
      const { url } = await uploadFile(req.file.buffer, fileName, req.file.mimetype);
      return res.json({ url });
    } catch (error) {
      console.log(`Erro no upload da imagem: ${error.message}`);
      return res.status(500).json({ message: "Erro ao fazer upload da imagem" });
    }
  },
};

module.exports = Files;
