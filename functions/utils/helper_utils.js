import { logger } from "firebase-functions";
import axios from "axios";

const sendSMS = async (phoneNumber, message) => {
    try {
        const response = await axios.post(
            `https://api.mnotify.com/api/sms/quick?key=${process.env.MNOTIFY_API_KEY}`,
           {"recipient":[phoneNumber],
             "sender":"ASAP", 
             "message":message,
              "is_schedule":"false",
               "schedule_date":""
            }
        );
        logger.info('SMS response:', response.data);
        if (response.status !== 200) {
            logger.error('SMS sending failed:', response.statusText);
            throw new Error(`SMS sending failed with status: ${response.status}`);
        }
    } catch (error) {
        logger.error('Error sending SMS:', error);
        throw new Error(`Failed to send SMS: ${error.message}`);
    }
};

const createTransferRecipient = async (phonenumber, networkCode, customerName) => {
  const createRecipientUrl = `${process.env.PAYSTACK_URL}/transferrecipient`;

  // Log to verify secret key is loaded (remove this in production)
  console.log('Paystack Secret Key:', process.env.PAYSTACK_SECRET ? 'Loaded' : 'Not loaded');

  try {
    const response = await axios.post(
      createRecipientUrl,
      {
        type: "mobile_money",
        name: customerName || "Paystack Transfer",
        account_number: phonenumber,
        bank_code: networkCode,
        currency: "GHS"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET}`  // Ensure PAYSTACK_SECRET holds only the secret key string, no 'Bearer' prefix
        }
      }
    );

    return response.data.data;
  } catch (error) {
    console.error('Error creating transfer recipient:', error.response?.data || error.message);
    throw new Error(`Failed to create transfer recipient: ${error.message}`);
  }
};
const transferFunds = async (tranferCode, amount, phonenumber) => {
    const transferUrl = `${process.env.PAYSTACK_URL}/transfer`;
    try {
        const response = await axios.post(
            transferUrl,
            {
                source: "balance",
                amount: amount * 100, // Convert to kobo
                recipient: tranferCode,
                currency: "GHS"
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.PAYSTACK_SECRET}`
                }
            }
        );
        logger.info('Transfer response:', response.data);
        if (response.status !== 200) {
            logger.error('Transfer failed:', response.statusText);
            throw new Error(`Transfer failed with status: ${response.status}`);
        }
        // await sendSMS(phonenumber, `You have successfully withdrawn GHS ${amount} to your mobile money account.`);
        logger.info('SMS sent successfully');
        return response.data;
    } catch (error) {
        console.error('Error transferring funds:', error);
        throw new Error(`Failed to transfer funds: ${error.message}`);
    }
};

export { sendSMS, createTransferRecipient, transferFunds };