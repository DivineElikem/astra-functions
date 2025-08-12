const functions = require("firebase-functions");
const admin = require("firebase-admin");
require('dotenv').config(); // For local testing

const { sendSMS, createTransferRecipient, transferFunds } = require("./utils/helper_utils");

admin.initializeApp();
const db = admin.firestore();

exports.depositWebhook = functions.https.onRequest(async (req, res) => {
  const event = req.body;
  console.log(event);

  if (event.event === "charge.success") {
    const data = event.data || {};

    // Extract user_id from metadata
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
      // Add to Firestore
      await db.collection("deposits").add(depositDoc);

      // Increment walletBalance in profiles collection if userId is available
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

      return res.status(200).send();
    } catch (error) {
      console.error("Error processing deposit:", error);
      return res.status(500).send("Internal Server Error");
    }
  } else {
    // For other events, just respond with 200
    return res.status(200).send();
  }
});

exports.sendSMSMessage = functions.https.onRequest(async (req, res) => {
  const { phone, message } = req.body;
  try {
    await sendSMS(phone, message);
    res.status(200).send({ success: true });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

exports.withdrawfunds = functions.https.onRequest(async (req, res) => {
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