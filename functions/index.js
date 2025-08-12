const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();


//Endpoint for Deposit webhook
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




//Endpoint for Transfer funds between user
exports.transferFunds = functions.https.onRequest(async (req, res) => {
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

    return res.status(200).json({ message: "Transfer successful" });
  } catch (error) {
    console.error("Transfer error:", error);
    return res.status(400).json({ error: error.message || "Transfer failed" });
  }
});







