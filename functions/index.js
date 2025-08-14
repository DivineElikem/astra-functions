const functions = require("firebase-functions");
const admin = require("firebase-admin");
require('dotenv').config(); // For local testing
const express = require("express");
const { FieldValue } = require("firebase-admin/firestore");
const { sendSMS, createTransferRecipient, transferFunds } = require("./utils/helper_utils");
const logger = require("firebase-functions/logger")
admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Welcome to the Firebase Cloud Functions API!");
});
// Deposit webhook route
app.post("/depositWebhook", async (req, res) => {
  const event = req.body;
  logger.log(event);

  if (event.event === "charge.success") {
    const data = event.data || {};
    const metadata = data.metadata;
    let userId = null;

    if (metadata && typeof metadata === "string") {
      const referrerMatch = metadata.match(/referrer":"([^"]+)/);
      if (referrerMatch) {
        const referrer = referrerMatch[1];
        const userIdMatch = referrer.match(/\/([\w\d]+)\?/);
        if (userIdMatch) {
          userId = userIdMatch[1];
        }
      }
    }

    const depositDoc = {
      userId: userId,
      amount: typeof data.amount === "number" ? data.amount / 100 : 0,
      status: data.status,
      createdAt: data.created_at,
      channel: data.channel,
      bank: data.authorization ? data.authorization.bank : undefined,
    };

    try {
      await db.collection("deposits").add(depositDoc);

      if (userId) {
        const profileRef = db.collection("profiles").doc(userId);
        const profileDoc = await profileRef.get();
        if (profileDoc.exists) {
          const profileData = profileDoc.data() || {};
          const currentBalance = profileData.walletBalance || 0;
          const depositAmount = depositDoc.amount ? Math.floor(depositDoc.amount) : 0;
          const newBalance = currentBalance + depositAmount;

          await profileRef.update({ walletBalance: newBalance });
        }
      }

      
      res.status(200).send();
    } catch (error) {
      console.error("Error processing deposit:", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    // For other events, just respond with 200
    res.status(200).send();
  }
});


// Transfer funds route
app.post("/transferFunds", async (req, res) => {
  try {
    const { sender_id, recipient_id, amount, description } = req.body;
    if (!sender_id || !recipient_id || !amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    const senderRef = db.collection("profiles").doc(sender_id);
    const recipientRef = db.collection("profiles").doc(recipient_id);

    await db.runTransaction(async (t) => {
      const senderDoc = await t.get(senderRef);
      const recipientDoc = await t.get(recipientRef);

      if (!senderDoc.exists || !recipientDoc.exists) {
        throw new Error("Sender or recipient not found");
      }

      const senderData = senderDoc.data();
      const recipientData = recipientDoc.data();
      const senderBalance = senderData.walletBalance || 0;
      const recipientBalance = recipientData.walletBalance || 0;

      if (senderBalance < amount) {
        throw new Error("Insufficient funds");
      }

      t.update(senderRef, { walletBalance: senderBalance - amount });
      t.update(recipientRef, { walletBalance: recipientBalance + amount });

      const transactionDoc = {
        amount,
        createdAt: FieldValue.serverTimestamp(),
        sender_id,
        recipient_id,
        description: description || "",
        status: "success",
      };
      t.set(db.collection("transactions").doc(), transactionDoc);
    });

    res.status(200).json({ message: "Transfer successful" });
  } catch (error) {
    console.error("Transfer error:", error);
    res.status(400).json({ error: error.message || "Transfer failed" });
  }
});


// Withdraw funds route
app.post("/withdrawfunds", async (req, res) => {
  try {
    const { phone, amount, network } = req.body;
    const transferrecipientData = await createTransferRecipient(phone, network);
    const recipientCode = transferrecipientData.recipient_code;
    if (recipientCode) {
      const response = await transferFunds(recipientCode, amount, phone);
      res.status(200).send(response);
    } else {
      res.status(400).send({ error: "Recipient code not found" });
    }
  } catch (error) {
    console.error('Error in withdrawfunds function:', error);
    res.status(500).send({ error: error.message });
  }
});


// Export the Express app as a single Cloud Function
exports.api = functions.https.onRequest(app);
