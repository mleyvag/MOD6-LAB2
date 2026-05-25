const express = require("express");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const keyVaultUrl = process.env.KEY_VAULT_URL;
const secretName =
  process.env.AWS_COTIZADOR_API_KEY_SECRET_NAME || "aws-cotizador-api-key";
const awsCotizadorEndpoint = process.env.AWS_COTIZADOR_ENDPOINT;
const managedIdentityClientId = process.env.AZURE_CLIENT_ID;

if (!keyVaultUrl) {
  throw new Error("Falta la variable de configuracion KEY_VAULT_URL.");
}

if (!awsCotizadorEndpoint) {
  throw new Error("Falta la variable de configuracion AWS_COTIZADOR_ENDPOINT.");
}

const credential = managedIdentityClientId
  ? new DefaultAzureCredential({ managedIdentityClientId })
  : new DefaultAzureCredential();

const secretClient = new SecretClient(keyVaultUrl, credential);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/cotizaciones", async (req, res) => {
  try {
    const body = req.body || {};
    const placa =
      typeof body.placa === "string" ? body.placa.trim().toUpperCase() : "";

    if (!placa) {
      return res.status(400).json({
        codigo: "PLACA_REQUERIDA",
        mensaje: "Debe enviar el atributo placa."
      });
    }

    if (!/^[A-Z0-9-]{5,10}$/.test(placa)) {
      return res.status(400).json({
        codigo: "PLACA_INVALIDA",
        mensaje: "La placa debe tener entre 5 y 10 caracteres alfanumericos."
      });
    }

    const secret = await secretClient.getSecret(secretName);

    if (!secret.value) {
      throw new Error("El secreto existe, pero no contiene un valor utilizable.");
    }

    const solicitudCotizacion = {
      placa,
      anioFabricacion: body.anioFabricacion || 2023,
      uso: body.uso || "PARTICULAR"
    };

    const awsResponse = await fetch(awsCotizadorEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": secret.value
      },
      body: JSON.stringify(solicitudCotizacion)
    });

    const responseText = await awsResponse.text();

    let awsBody;
    try {
      awsBody = JSON.parse(responseText);
    } catch (_error) {
      awsBody = { mensajeProveedor: responseText };
    }

    if (!awsResponse.ok) {
      console.error(`El API externo respondio con estado HTTP ${awsResponse.status}.`);

      return res.status(502).json({
        codigo: "ERROR_PROVEEDOR_COTIZACION",
        mensaje: "No fue posible obtener la cotizacion del proveedor externo.",
        proveedorStatus: awsResponse.status
      });
    }

    return res.status(200).json({
      origen: "AZURE_CONTAINER_APP_SECURE_PROXY",
      solicitud: solicitudCotizacion,
      proveedor: "AWS_API_GATEWAY_MOCK",
      resultado: awsBody
    });
  } catch (error) {
    console.error(`Error procesando la cotizacion: ${error.message}`);

    return res.status(500).json({
      codigo: "ERROR_INTERNO",
      mensaje: "No fue posible procesar la cotizacion."
    });
  }
});

app.listen(port, () => {
  console.log(`Cotizador escuchando en el puerto ${port}.`);
});
